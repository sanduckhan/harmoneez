import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import type { FlowStep, MelodyNote, PitchSample, PipelineResult } from '../types';
import { getMelodyData, getAmplitudeData, getPitchContour, uploadFile, startProcessing } from '../api';
import type { AmplitudeData, PitchContourData } from '../api';
import { useJobProgress } from '../hooks/useJobProgress';
import { usePitchDetection } from '../hooks/usePitchDetection';
import { PitchCanvas } from './PitchCanvas';
import type { CanvasMode } from './PitchCanvas';
import { TransportBar } from './TransportBar';
import { ProgressPanel } from './ProgressPanel';
import { ResultsGrid } from './ResultsGrid';
import { useWebAudioPlayer } from '../hooks/useWebAudioPlayer';
import { formatTime, getScalePitchClasses, findActiveNote, NOTE_NAMES } from '../utils';

interface ResumedSession {
  jobId: string;
  filename: string;
  key: string;
  duration: number;
}

interface Props {
  onBack: () => void;
  onChangeKey?: () => void;
  resumedSession?: ResumedSession;
}

export function PracticeView({ onBack, onChangeKey, resumedSession }: Props) {
  const [step, setStep] = useState<FlowStep>('loading');

  // Reference track
  const [refJobId, setRefJobId] = useState<string | null>(resumedSession?.jobId ?? null);
  const [refFilename, setRefFilename] = useState<string | null>(resumedSession?.filename ?? null);
  const [melodyNotes, setMelodyNotes] = useState<MelodyNote[]>([]);
  const [detectedKey, setDetectedKey] = useState<string>(resumedSession?.key ?? 'C major');
  const [amplitudeData, setAmplitudeData] = useState<AmplitudeData | null>(null);
  const [pitchContourData, setPitchContourData] = useState<PitchContourData | null>(null);
  const [refDuration, setRefDuration] = useState(resumedSession?.duration ?? 0);
  const [vocalsOn, setVocalsOn] = useState(true);
  const [bandOn, setBandOn] = useState(true);
  const [seekVersion, setSeekVersion] = useState(0);

  // Audio — derive source from mute toggles
  const audioSrcUrl = refJobId ? (
    vocalsOn && bandOn ? `/api/files/${refJobId}/full_mix.wav` :
    vocalsOn ? `/api/files/${refJobId}/vocals.wav` :
    bandOn ? `/api/files/${refJobId}/instrumental.wav` :
    `/api/files/${refJobId}/full_mix.wav` // both off — muted via gain node
  ) : null;

  const [currentTime, setCurrentTime] = useState(0);
  const lastTimeUpdateRef = useRef(0);

  const webAudio = useWebAudioPlayer({
    url: audioSrcUrl,
    detune: 0,
    muted: !vocalsOn && !bandOn,
    onTimeUpdate: (t) => {
      const now = Date.now();
      if (now - lastTimeUpdateRef.current > 250) {
        lastTimeUpdateRef.current = now;
        setCurrentTime(t);
      }
    },
  });

  const isPlaying = webAudio.playing;
  const scalePCs = useMemo(() => getScalePitchClasses(detectedKey), [detectedKey]);

  // Recording
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const pitchSamplesRef = useRef<PitchSample[]>([]);
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  const recordStartTimeRef = useRef(0);
  const recordAudioOffsetRef = useRef(0);

  // Recorded vocal processing
  const [vocalJobId, setVocalJobId] = useState<string | null>(null);
  const [processingVocal, setProcessingVocal] = useState(false);
  const vocalProgress = useJobProgress(vocalJobId, processingVocal);
  const [result, setResult] = useState<PipelineResult | null>(null);

  // Section selection
  const [selStart, setSelStart] = useState<number | null>(null);
  const [selEnd, setSelEnd] = useState<number | null>(null);

  // Shared helper: load melody + amplitude + contour for a job
  const loadSessionData = useCallback(async (jobId: string) => {
    const [notes, amp, contour] = await Promise.all([
      getMelodyData(jobId),
      getAmplitudeData(jobId),
      getPitchContour(jobId),
    ]);
    setMelodyNotes(notes);
    setAmplitudeData(amp);
    setPitchContourData(contour);
  }, []);

  // Load session data on mount
  useEffect(() => {
    if (!refJobId) return;
    loadSessionData(refJobId)
      .then(() => setStep('guide'))
      .catch(() => { alert('Failed to load session data.'); onBack(); });
  }, [refJobId, loadSessionData, onBack]);

  // Use ref for mic stream to avoid stale closures
  const micStreamRef = useRef<MediaStream | null>(null);

  // Watch for playback end during recording
  const prevPlayingRef = useRef(false);
  useEffect(() => {
    if (prevPlayingRef.current && !isPlaying && step === 'recording') {
      setRecordingPaused(false);
      mediaRecorderRef.current?.stop();
      micStreamRef.current?.getTracks().forEach(t => t.stop());
      micStreamRef.current = null;
      setMicStream(null);
      setStep('review');
    }
    prevPlayingRef.current = isPlaying;
  }, [isPlaying, step]);

  // --- Guide mode ---
  const playReference = useCallback(() => webAudio.play(), [webAudio]);
  const pauseReference = useCallback(() => webAudio.pause(), [webAudio]);

  // --- Recording ---
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      setMicStream(stream);

      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mediaRecorderRef.current = recorder;
      recorder.start(100);

      pitchSamplesRef.current = [];
      recordStartTimeRef.current = Date.now();
      pausedElapsedRef.current = 0;
      recordAudioOffsetRef.current = webAudio.getTime();
      setRecordingPaused(false);

      // Start reference playback if not already playing
      if (!webAudio.playing) webAudio.play();

      setStep('recording');
    } catch {
      alert('Microphone access denied. Please allow mic access in your browser settings.');
    }
  }, [webAudio]);

  const [recordingPaused, setRecordingPaused] = useState(false);
  const pausedElapsedRef = useRef(0);

  const pauseRecording = useCallback(() => {
    // Accumulate elapsed time before pausing
    pausedElapsedRef.current += (Date.now() - recordStartTimeRef.current) / 1000;
    mediaRecorderRef.current?.pause();
    webAudio.pause();
    setRecordingPaused(true);
  }, [webAudio]);

  const resumeRecording = useCallback(() => {
    recordStartTimeRef.current = Date.now();
    mediaRecorderRef.current?.resume();
    webAudio.play();
    setRecordingPaused(false);
  }, [webAudio]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    micStreamRef.current = null;
    setMicStream(null);
    webAudio.pause();
    setRecordingPaused(false);
    setStep('review');
  }, [webAudio]);

  // Pitch detection during recording (disabled when paused)
  usePitchDetection({
    stream: micStream,
    enabled: step === 'recording' && !recordingPaused,
    onPitchDetected: (sample) => {
      pitchSamplesRef.current.push(sample);
      setRecordingElapsed(sample.time);
    },
    getElapsedTime: () => recordAudioOffsetRef.current + pausedElapsedRef.current + (Date.now() - recordStartTimeRef.current) / 1000,
  });

  // --- Review ---
  const debugVocalsRef = useRef<HTMLAudioElement>(null);

  const handleScrub = useCallback((time: number) => {
    webAudio.seek(time);
    setCurrentTime(time);
    if (debugVocalsRef.current) {
      debugVocalsRef.current.currentTime = time;
    }
  }, [webAudio]);

  const handleRegionSelect = useCallback((start: number, end: number) => {
    setSelStart(start);
    setSelEnd(end);
  }, []);

  const reRecord = useCallback(() => {
    pitchSamplesRef.current = [];
    setRecordingElapsed(0);
    setSelStart(null);
    setSelEnd(null);
    setStep('guide');
  }, []);

  // --- Generate harmonies ---
  const generateHarmonies = useCallback(async () => {
    if (!chunksRef.current.length) return;

    setStep('generating');
    setProcessingVocal(true);

    try {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      const file = new File([blob], 'recording.webm', { type: 'audio/webm' });
      const res = await uploadFile(file);
      setVocalJobId(res.job_id);

      await startProcessing(res.job_id, {
        key: detectedKey,
        start: selStart ?? undefined,
        end: selEnd ?? undefined,
        pitch_correct: true,
        harmony_volume: 0.7,
      });
    } catch (e) {
      alert(`Processing failed: ${e}`);
      setStep('review');
      setProcessingVocal(false);
    }
  }, [detectedKey, selStart, selEnd]);

  // Watch vocal processing completion
  useEffect(() => {
    if (vocalProgress?.status === 'completed' && vocalProgress.result) {
      setResult(vocalProgress.result);
      setProcessingVocal(false);
      setStep('results');
    }
    if (vocalProgress?.status === 'failed') {
      setProcessingVocal(false);
      setStep('review');
      alert('Processing failed: ' + (vocalProgress.error || 'Unknown error'));
    }
  }, [vocalProgress]);

  // Accuracy score — computed once on entering review mode
  const [accuracyScore, setAccuracyScore] = useState(0);
  useEffect(() => {
    if (step !== 'review') return;
    const samples = pitchSamplesRef.current;
    if (!samples || samples.length === 0) { setAccuracyScore(0); return; }
    const voiced = samples.filter(s => s.midi !== null);
    if (voiced.length === 0) { setAccuracyScore(0); return; }
    let inTuneCount = 0;
    for (const s of voiced) {
      const note = findActiveNote(melodyNotes, s.time);
      if (note && Math.abs(s.midi! - note.midi_pitch) * 100 < 20) inTuneCount++;
    }
    setAccuracyScore(Math.round((inTuneCount / voiced.length) * 100));
  }, [step, melodyNotes]);

  // Clear selection helper
  const clearSelection = useCallback(() => {
    setSelStart(null);
    setSelEnd(null);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      // Ignore during loading/generating/results
      if (step === 'loading' || step === 'generating') return;

      switch (e.key) {
        case ' ': // Space — play/pause or pause/resume recording
          e.preventDefault();
          if (step === 'guide' || step === 'review') {
            if (isPlaying) webAudio.pause();
            else webAudio.play();
          } else if (step === 'recording') {
            if (recordingPaused) resumeRecording();
            else pauseRecording();
          }
          break;

        case 'r': // R — start recording (guide) or re-record (review/results)
          if (step === 'guide') startRecording();
          else if (step === 'review' || step === 'results') reRecord();
          break;

        case 'Escape': // Escape — stop recording or clear selection
          if (step === 'recording') stopRecording();
          else if (step === 'review' && (selStart !== null || selEnd !== null)) clearSelection();
          break;

        case 'ArrowLeft': // Cmd+Left = start, Shift+Left = -0.5s, Left = -2s
          e.preventDefault();
          if (step === 'guide' || step === 'review') {
            if (e.metaKey) {
              handleScrub(0);
            } else {
              const delta = e.shiftKey ? 0.5 : 2;
              handleScrub(Math.max(0, webAudio.getTime() - delta));
            }
            setSeekVersion(v => v + 1);
          }
          break;

        case 'ArrowRight': // Cmd+Right = end, Shift+Right = +0.5s, Right = +2s
          e.preventDefault();
          if (step === 'guide' || step === 'review') {
            if (e.metaKey) {
              handleScrub(webAudio.duration);
            } else {
              const delta = e.shiftKey ? 0.5 : 2;
              handleScrub(Math.min(webAudio.duration, webAudio.getTime() + delta));
            }
            setSeekVersion(v => v + 1);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [step, isPlaying, recordingPaused, selStart, selEnd, webAudio, startRecording, stopRecording, pauseRecording, resumeRecording, reRecord, clearSelection, handleScrub]);

  // Cleanup mic on unmount
  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stop();
      micStreamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  // Canvas mode mapping
  const canvasMode: CanvasMode =
    step === 'recording' ? 'recording' :
    step === 'review' ? 'review' :
    'guide';

  return (
    <div className="space-y-4">
      {/* Loading */}
      {step === 'loading' && (
        <div className="flex items-center justify-center gap-3 py-16">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
            className="w-5 h-5 border-2 border-[var(--amber)] border-t-transparent rounded-full"
          />
          <span className="text-sm font-mono text-[var(--text-secondary)]">Loading session data...</span>
        </div>
      )}

      {/* Guide / Recording / Review */}
      {(step === 'guide' || step === 'recording' || step === 'review') && (
        <div className="space-y-4">
          {/* File info */}
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-[var(--bg-panel)] border border-[var(--border)]">
            <div className={`w-2 h-2 rounded-full ${step === 'recording' ? 'bg-[var(--red)] shadow-[0_0_6px_var(--red)]' : 'bg-[var(--teal)] shadow-[0_0_4px_var(--teal)]'}`} />
            <span className="text-xs font-mono text-[var(--text-secondary)] flex-1">{refFilename}</span>
            <span className="text-xs font-mono text-[var(--amber)]">{detectedKey}</span>
            <button
              onClick={() => { webAudio.pause(); onChangeKey?.(); }}
              className="text-[10px] font-mono text-[var(--text-muted)] hover:text-[var(--amber)] transition-colors uppercase tracking-wider"
            >
              Change
            </button>
          </div>

          {/* Pitch canvas */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--border)] bg-[var(--bg-surface)]">
              <div className={`w-2 h-2 rounded-full ${
                step === 'recording' ? 'bg-[var(--red)] shadow-[0_0_6px_var(--red)] animate-pulse' :
                isPlaying ? 'bg-[var(--teal)] shadow-[0_0_6px_var(--teal)]' :
                'bg-[var(--text-muted)]'
              }`} />
              <span className="text-xs font-mono text-[var(--text-muted)] uppercase tracking-widest">
                {step === 'recording' ? 'Recording' : step === 'review' ? 'Review' : 'Melody Guide'}
              </span>
              {step === 'recording' && (
                <span className="text-xs font-mono text-[var(--red)] ml-auto tabular-nums">
                  {formatTime(recordingElapsed)}
                </span>
              )}
              {step === 'review' && (
                <span className="text-xs font-mono text-[var(--text-muted)] ml-auto">
                  Accuracy: <span className={`${accuracyScore >= 70 ? 'text-[var(--teal)]' : accuracyScore >= 50 ? 'text-[var(--amber)]' : 'text-[var(--red)]'}`}>{accuracyScore}%</span>
                </span>
              )}
            </div>

            <PitchCanvas
              melodyNotes={melodyNotes}
              pitchSamplesRef={pitchSamplesRef}
              getTime={webAudio.getTime}
              duration={refDuration || webAudio.duration}
              mode={canvasMode}
              isPlaying={isPlaying || (step === 'recording' && !recordingPaused)}
              scalePitchClasses={scalePCs}
              amplitude={amplitudeData}
              pitchContour={pitchContourData}
              selection={selStart !== null && selEnd !== null ? { start: selStart, end: selEnd } : null}
              onScrub={handleScrub}
              onRegionSelect={handleRegionSelect}
              onClearSelection={clearSelection}
              seekVersion={seekVersion}
            />

            {/* Transport bar — attached to bottom of canvas */}
            <TransportBar
              step={step}
              isPlaying={isPlaying}
              recordingPaused={recordingPaused}
              currentTime={currentTime}
              duration={refDuration || webAudio.duration}
              vocalsOn={vocalsOn}
              bandOn={bandOn}
              selStart={selStart}
              selEnd={selEnd}
              onPlay={playReference}
              onPause={pauseReference}
              onSeekToStart={() => { handleScrub(0); setSeekVersion(v => v + 1); }}
              onSeek={(t) => { handleScrub(t); setSeekVersion(v => v + 1); }}
              onStartRecording={startRecording}
              onStopRecording={stopRecording}
              onPauseRecording={pauseRecording}
              onResumeRecording={resumeRecording}
              onReRecord={reRecord}
              onToggleVocals={() => setVocalsOn(v => !v)}
              onToggleBand={() => setBandOn(v => !v)}
              onGenerateHarmonies={generateHarmonies}
            />
          </div>


          {/* Debug panel */}
          {refJobId && (
            <details className="rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] overflow-hidden">
              <summary className="px-4 py-2 text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-widest cursor-pointer hover:text-[var(--text-secondary)] bg-[var(--bg-surface)]">
                Debug: Audio Stems
              </summary>
              <div className="p-4 space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-widest">Isolated Vocals</span>
                    <span className="text-[10px] font-mono text-[var(--text-muted)]">Click on canvas to seek here</span>
                  </div>
                  <audio ref={debugVocalsRef} src={`/api/files/${refJobId}/vocals.wav`} controls className="w-full h-8" preload="none" />
                </div>
                <div>
                  <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-widest">Instrumental</span>
                  <audio src={`/api/files/${refJobId}/instrumental.wav`} controls className="w-full mt-1 h-8" preload="none" />
                </div>
                <div className="text-[10px] font-mono text-[var(--text-muted)]">
                  Key: {detectedKey} · Notes: {melodyNotes.length} · Duration: {refDuration.toFixed(1)}s ·
                  Scale: {getScalePitchClasses(detectedKey).map(pc =>
                    NOTE_NAMES[pc]
                  ).join(' ')}
                </div>
              </div>
            </details>
          )}
        </div>
      )}

      {/* Generating */}
      {step === 'generating' && (
        <ProgressPanel progress={vocalProgress} />
      )}

      {/* Results */}
      {step === 'results' && result && vocalJobId && (
        <div className="space-y-4">
          <ResultsGrid jobId={vocalJobId} result={result} />
          <button
            onClick={reRecord}
            className="text-xs font-mono text-[var(--text-muted)] hover:text-[var(--amber)] transition-colors uppercase tracking-wider"
          >
            Record again
          </button>
        </div>
      )}

      {/* Back button */}
      <button
        onClick={onBack}
        className="text-[10px] font-mono text-[var(--text-muted)] hover:text-[var(--amber)] transition-colors uppercase tracking-wider"
      >
        ← Back
      </button>

    </div>
  );
}
