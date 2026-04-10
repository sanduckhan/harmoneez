import { useState, useRef, useCallback, useEffect } from 'react';
import { motion } from 'motion/react';
import type { MelodyNote, PitchSample, PipelineResult } from '../types';
import { uploadFile, prepareReference, getMelodyData, getAmplitudeData, getPitchContour, startProcessing, audioUrl } from '../api';
import type { AmplitudeData, PitchContourData } from '../api';
import { useJobProgress } from '../hooks/useJobProgress';
import { usePitchDetection } from '../hooks/usePitchDetection';
import { PitchCanvas } from './PitchCanvas';
import type { CanvasMode } from './PitchCanvas';
import { ProgressPanel } from './ProgressPanel';
import { ResultsGrid } from './ResultsGrid';
import { useWebAudioPlayer } from '../hooks/useWebAudioPlayer';
import { formatTime, getScalePitchClasses, transposeKey } from '../utils';

type FlowStep = 'upload' | 'preparing' | 'guide' | 'recording' | 'review' | 'generating' | 'results';

interface ResumedSession {
  jobId: string;
  filename: string;
  key: string;
  duration: number;
}

interface Props {
  onBack: () => void;
  resumedSession?: ResumedSession;
}

export function PracticeView({ onBack, resumedSession }: Props) {
  const [step, setStep] = useState<FlowStep>(resumedSession ? 'preparing' : 'upload');

  // Reference track
  const [refJobId, setRefJobId] = useState<string | null>(null);
  const [refFilename, setRefFilename] = useState<string | null>(null);
  const [melodyNotes, setMelodyNotes] = useState<MelodyNote[]>([]);
  const [detectedKey, setDetectedKey] = useState<string>('C major');
  const [transposeOffset, setTransposeOffset] = useState(0);
  const [amplitudeData, setAmplitudeData] = useState<AmplitudeData | null>(null);
  const [pitchContourData, setPitchContourData] = useState<PitchContourData | null>(null);
  const [refDuration, setRefDuration] = useState(0);

  // Audio — Web Audio API for pitch-shifted playback
  const audioSrcUrl = refJobId ? (
    audioSource === 'vocals' ? `/api/files/${refJobId}/vocals.wav` :
    audioSource === 'instrumental' ? `/api/files/${refJobId}/instrumental.wav` :
    audioUrl(refJobId)
  ) : null;

  const [currentTime, setCurrentTime] = useState(0);
  const currentTimeRef = useRef(0);

  const webAudio = useWebAudioPlayer({
    url: audioSrcUrl,
    detune: transposeOffset * 100,
    onTimeUpdate: (t) => {
      currentTimeRef.current = t;
      setCurrentTime(t);
    },
  });

  const isPlaying = webAudio.playing;
  const refDurationFromAudio = webAudio.duration;

  // Recording
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const pitchSamplesRef = useRef<PitchSample[]>([]);
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  const recordStartTimeRef = useRef(0);
  const recordAudioOffsetRef = useRef(0);
  const [audioSource, setAudioSource] = useState<'mix' | 'vocals' | 'instrumental'>('mix');

  // Recorded vocal processing
  const [vocalJobId, setVocalJobId] = useState<string | null>(null);
  const [processingVocal, setProcessingVocal] = useState(false);
  const vocalProgress = useJobProgress(vocalJobId, processingVocal);
  const [result, setResult] = useState<PipelineResult | null>(null);

  // Section selection
  const [selStart, setSelStart] = useState<number | null>(null);
  const [selEnd, setSelEnd] = useState<number | null>(null);

  // Prepare progress
  const prepareProgress = useJobProgress(refJobId, step === 'preparing');

  // --- Resume from saved session ---
  useEffect(() => {
    if (!resumedSession) return;
    setRefJobId(resumedSession.jobId);
    setRefFilename(resumedSession.filename);
    setRefDuration(resumedSession.duration);
    setDetectedKey(resumedSession.key);
    Promise.all([
      getMelodyData(resumedSession.jobId),
      getAmplitudeData(resumedSession.jobId),
      getPitchContour(resumedSession.jobId),
    ]).then(([notes, amp, contour]) => {
      setMelodyNotes(notes);
      setAmplitudeData(amp);
      setPitchContourData(contour);
      setStep('guide');
    }).catch(() => {
      alert('Failed to load session data.');
      setStep('upload');
    });
  }, [resumedSession]);

  // --- Upload reference ---
  const handleUploadRef = useCallback(async (file: File) => {
    setStep('preparing');
    try {
      const res = await uploadFile(file);
      setRefJobId(res.job_id);
      setRefFilename(file.name);
      setRefDuration(res.duration);
      await prepareReference(res.job_id);
    } catch (e) {
      alert(`Upload failed: ${e}`);
      setStep('upload');
    }
  }, []);

  // Watch prepare completion
  useEffect(() => {
    if (prepareProgress?.status === 'completed' && step === 'preparing' && refJobId) {
      Promise.all([
        getMelodyData(refJobId),
        getAmplitudeData(refJobId),
        getPitchContour(refJobId),
      ]).then(([notes, amp, contour]) => {
        setMelodyNotes(notes);
        setAmplitudeData(amp);
        setPitchContourData(contour);
        if (prepareProgress.result?.key) {
          setDetectedKey(prepareProgress.result.key as string);
        }
        setStep('guide');
      }).catch(() => {
        alert('Failed to load melody data. Please try again.');
        setStep('upload');
      });
    }
  }, [prepareProgress, step, refJobId]);

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

      // Start reference playback from current playhead position
      webAudio.play();

      setStep('recording');
    } catch {
      alert('Microphone access denied. Please allow mic access in your browser settings.');
    }
  }, []);

  const [recordingPaused, setRecordingPaused] = useState(false);
  const pausedElapsedRef = useRef(0);

  const pauseRecording = useCallback(() => {
    // Accumulate elapsed time before pausing
    pausedElapsedRef.current += (Date.now() - recordStartTimeRef.current) / 1000;
    mediaRecorderRef.current?.pause();
    webAudio.pause();
    setRecordingPaused(true);
  }, []);

  const resumeRecording = useCallback(() => {
    recordStartTimeRef.current = Date.now();
    mediaRecorderRef.current?.resume();
    webAudio.play();
    setRecordingPaused(false);
  }, []);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    micStreamRef.current = null;
    setMicStream(null);
    webAudio.pause();
    setRecordingPaused(false);
    setStep('review');
  }, []);

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
      // Binary search for active note
      let lo = 0, hi = melodyNotes.length - 1, found = false;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (melodyNotes[mid].end_sec < s.time) lo = mid + 1;
        else if (melodyNotes[mid].start_sec > s.time) hi = mid - 1;
        else { found = true; if (Math.abs(s.midi! - melodyNotes[mid].midi_pitch) * 100 < 20) inTuneCount++; break; }
      }
    }
    setAccuracyScore(Math.round((inTuneCount / voiced.length) * 100));
  }, [step, melodyNotes]);

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
      {/* Audio is handled by useWebAudioPlayer — no <audio> element needed */}

      {/* Upload */}
      {step === 'upload' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="border border-dashed border-[var(--border)] rounded-xl p-16 text-center cursor-pointer hover:border-[var(--border-highlight)] transition-colors bg-[var(--bg-panel)]"
          onClick={() => document.getElementById('ref-file-input')?.click()}
        >
          <input
            id="ref-file-input"
            type="file"
            accept=".wav,.mp3"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUploadRef(file);
            }}
          />
          <p className="text-lg text-[var(--text-primary)] font-medium">Upload the reference track</p>
          <p className="text-sm text-[var(--text-muted)] mt-2 font-mono">The original song your band plays</p>
        </motion.div>
      )}

      {/* Preparing */}
      {step === 'preparing' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-[var(--bg-panel)] border border-[var(--border)]">
            <div className="w-2 h-2 rounded-full bg-[var(--amber)] shadow-[0_0_4px_var(--amber)]" />
            <span className="text-xs font-mono text-[var(--text-secondary)]">{refFilename}</span>
          </div>
          <ProgressPanel progress={prepareProgress} />
        </div>
      )}

      {/* Guide / Recording / Review */}
      {(step === 'guide' || step === 'recording' || step === 'review') && (
        <div className="space-y-4">
          {/* File info */}
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-[var(--bg-panel)] border border-[var(--border)]">
            <div className={`w-2 h-2 rounded-full ${step === 'recording' ? 'bg-[var(--red)] shadow-[0_0_6px_var(--red)]' : 'bg-[var(--teal)] shadow-[0_0_4px_var(--teal)]'}`} />
            <span className="text-xs font-mono text-[var(--text-secondary)] flex-1">{refFilename}</span>
            <span className="text-xs font-mono text-[var(--amber)]">
              {transposeOffset === 0 ? detectedKey : `${transposeKey(detectedKey, transposeOffset)} (${transposeOffset > 0 ? '+' : ''}${transposeOffset})`}
            </span>
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
              duration={refDuration || refDurationFromAudio}
              transposeOffset={transposeOffset}
              mode={canvasMode}
              isPlaying={isPlaying || (step === 'recording' && !recordingPaused)}
              scalePitchClasses={getScalePitchClasses(transposeKey(detectedKey, transposeOffset))}
              amplitude={amplitudeData}
              pitchContour={pitchContourData}
              onScrub={handleScrub}
              onRegionSelect={handleRegionSelect}
            />
          </div>

          {/* Controls */}
          <div className="flex items-center gap-3">
            {step === 'guide' && (
              <>
                <button
                  onClick={isPlaying ? pauseReference : playReference}
                  className="px-4 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-highlight)] hover:border-[var(--amber)]/50 text-sm font-mono text-[var(--text-secondary)] transition-all"
                >
                  {isPlaying ? 'PAUSE' : 'PREVIEW'}
                </button>
                <button
                  onClick={startRecording}
                  className="flex items-center gap-2 px-6 py-2 rounded-lg bg-[var(--red)] text-white font-mono uppercase tracking-wider text-sm hover:shadow-[0_0_20px_var(--red-glow)] transition-all"
                >
                  <div className="w-2.5 h-2.5 rounded-full bg-white" />
                  Record
                </button>
                {/* Transpose controls */}
                <div className="flex items-center gap-1 bg-[var(--bg-surface)] rounded border border-[var(--border)] text-[10px] font-mono overflow-hidden">
                  <button
                    onClick={() => setTransposeOffset(v => Math.max(-6, v - 1))}
                    className="px-2 py-1 text-[var(--text-muted)] hover:text-[var(--amber)] transition-colors"
                  >-</button>
                  <span className={`px-1.5 py-1 min-w-[3ch] text-center ${transposeOffset === 0 ? 'text-[var(--text-muted)]' : 'text-[var(--amber)] font-semibold'}`}>
                    {transposeOffset > 0 ? `+${transposeOffset}` : transposeOffset}
                  </span>
                  <button
                    onClick={() => setTransposeOffset(v => Math.min(6, v + 1))}
                    className="px-2 py-1 text-[var(--text-muted)] hover:text-[var(--amber)] transition-colors"
                  >+</button>
                </div>

                {/* Audio source selector */}
                <div className="flex items-center gap-1 ml-auto bg-[var(--bg-surface)] rounded border border-[var(--border)] text-[10px] font-mono overflow-hidden">
                  {(['mix', 'vocals', 'instrumental'] as const).map((src) => (
                    <button
                      key={src}
                      onClick={() => setAudioSource(src)}
                      className={`px-2.5 py-1 transition-all uppercase tracking-wider ${
                        audioSource === src
                          ? 'bg-[var(--amber)] text-[var(--bg-deep)] font-semibold'
                          : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                      }`}
                    >
                      {src === 'mix' ? 'Full' : src === 'vocals' ? 'Vocals' : 'Band'}
                    </button>
                  ))}
                </div>
              </>
            )}

            {step === 'recording' && (
              <>
                <button
                  onClick={recordingPaused ? resumeRecording : pauseRecording}
                  className="px-4 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-highlight)] hover:border-[var(--amber)]/50 text-sm font-mono text-[var(--text-secondary)] transition-all"
                >
                  {recordingPaused ? 'RESUME' : 'PAUSE'}
                </button>
                <button
                  onClick={stopRecording}
                  className="flex items-center gap-2 px-6 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-highlight)] hover:border-[var(--red)] text-sm font-mono text-[var(--text-primary)] transition-all"
                >
                  <div className="w-2.5 h-2.5 rounded-sm bg-[var(--red)]" />
                  Stop
                </button>
              </>
            )}

            {step === 'review' && (
              <>
                <button
                  onClick={reRecord}
                  className="px-4 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-highlight)] text-xs font-mono uppercase tracking-wider text-[var(--text-secondary)] hover:border-[var(--amber)]/50 transition-all"
                >
                  Re-record
                </button>
                <button
                  onClick={generateHarmonies}
                  className="px-6 py-2 rounded-lg bg-[var(--amber)] text-[var(--bg-deep)] font-mono uppercase tracking-wider text-xs font-bold hover:shadow-[0_0_20px_var(--amber-glow)] transition-all"
                >
                  {selStart !== null ? `Generate (${formatTime(selStart)}-${formatTime(selEnd!)})` : 'Generate All'}
                </button>
                <span className="text-[10px] font-mono text-[var(--text-muted)] ml-auto">
                  {selStart !== null ? 'Section selected' : 'Shift+drag to select section'}
                </span>
              </>
            )}
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
                  Key: {transposeOffset === 0 ? detectedKey : transposeKey(detectedKey, transposeOffset)} · Notes: {melodyNotes.length} · Duration: {refDuration.toFixed(1)}s ·
                  Scale: {getScalePitchClasses(transposeKey(detectedKey, transposeOffset)).map(pc =>
                    ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'][pc]
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
        Back to home
      </button>
    </div>
  );
}
