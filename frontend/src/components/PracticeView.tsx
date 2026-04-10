import { useState, useRef, useCallback, useEffect } from 'react';
import { motion } from 'motion/react';
import type { MelodyNote, PitchSample, PipelineResult } from '../types';
import { uploadFile, prepareReference, getMelodyData, startProcessing, audioUrl } from '../api';
import { useJobProgress } from '../hooks/useJobProgress';
import { usePitchDetection } from '../hooks/usePitchDetection';
import { PitchCanvas } from './PitchCanvas';
import type { CanvasMode } from './PitchCanvas';
import { ProgressPanel } from './ProgressPanel';
import { ResultsGrid } from './ResultsGrid';
import { formatTime, getScalePitchClasses } from '../utils';

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
  const [refDuration, setRefDuration] = useState(0);

  // Audio
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Recording
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const pitchSamplesRef = useRef<PitchSample[]>([]);
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  const recordStartTimeRef = useRef(0);
  const [referenceMuted, setReferenceMuted] = useState(false);

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
    getMelodyData(resumedSession.jobId).then((notes) => {
      setMelodyNotes(notes);
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
      getMelodyData(refJobId).then((notes) => {
        setMelodyNotes(notes);
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

  // Audio time sync — throttled to ~15fps for UI, PitchCanvas reads ref directly
  const timeSyncRef = useRef<number>(0);
  const currentTimeRef = useRef(0);
  const lastTimeUpdateRef = useRef(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlay = () => {
      setIsPlaying(true);
      const sync = () => {
        if (audio.paused) return;
        currentTimeRef.current = audio.currentTime;
        // Throttle React setState to ~15fps (every ~66ms)
        const now = performance.now();
        if (now - lastTimeUpdateRef.current > 66) {
          setCurrentTime(audio.currentTime);
          lastTimeUpdateRef.current = now;
        }
        timeSyncRef.current = requestAnimationFrame(sync);
      };
      timeSyncRef.current = requestAnimationFrame(sync);
    };
    const onPause = () => {
      setIsPlaying(false);
      cancelAnimationFrame(timeSyncRef.current);
      setCurrentTime(audio.currentTime);
    };
    const onEnded = () => {
      setIsPlaying(false);
      cancelAnimationFrame(timeSyncRef.current);
      setRecordingPaused(false);
      mediaRecorderRef.current?.stop();
      micStreamRef.current?.getTracks().forEach(t => t.stop());
      micStreamRef.current = null;
      setMicStream(null);
      setStep(prev => prev === 'recording' ? 'review' : prev);
    };
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    return () => {
      cancelAnimationFrame(timeSyncRef.current);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
    };
  }, [refJobId]);

  // --- Guide mode ---
  const playReference = useCallback(() => {
    audioRef.current?.play();
  }, []);

  const pauseReference = useCallback(() => {
    audioRef.current?.pause();
  }, []);

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
      setRecordingPaused(false);

      // Start reference playback
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play();
      }

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
    audioRef.current?.pause();
    setRecordingPaused(true);
  }, []);

  const resumeRecording = useCallback(() => {
    recordStartTimeRef.current = Date.now(); // reset wall-clock base
    mediaRecorderRef.current?.resume();
    audioRef.current?.play();
    setRecordingPaused(false);
  }, []);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    micStreamRef.current = null;
    setMicStream(null);
    audioRef.current?.pause();
    setIsPlaying(false);
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
    getElapsedTime: () => pausedElapsedRef.current + (Date.now() - recordStartTimeRef.current) / 1000,
  });

  // --- Review ---
  const handleScrub = useCallback((time: number) => {
    setCurrentTime(time);
    if (audioRef.current) audioRef.current.currentTime = time;
  }, []);

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
      cancelAnimationFrame(timeSyncRef.current);
    };
  }, []);

  // Canvas mode mapping
  const canvasMode: CanvasMode =
    step === 'recording' ? 'recording' :
    step === 'review' ? 'review' :
    'guide';

  return (
    <div className="space-y-4">
      {/* Hidden audio for reference track */}
      {refJobId && (
        <audio ref={audioRef} src={audioUrl(refJobId)} muted={referenceMuted} preload="auto" />
      )}

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
            <span className="text-xs font-mono text-[var(--amber)]">{detectedKey}</span>
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
              getTime={() => audioRef.current?.currentTime ?? currentTimeRef.current}
              duration={refDuration}
              mode={canvasMode}
              isPlaying={isPlaying || (step === 'recording' && !recordingPaused)}
              scalePitchClasses={getScalePitchClasses(detectedKey)}
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
                {/* Mute toggle */}
                <label className="flex items-center gap-2 ml-auto cursor-pointer">
                  <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase">Audio</span>
                  <button
                    onClick={() => setReferenceMuted(!referenceMuted)}
                    className={`relative w-8 h-4 rounded-full transition-all ${
                      !referenceMuted ? 'bg-[var(--amber)]' : 'bg-[var(--bg-surface)] border border-[var(--border-highlight)]'
                    }`}
                  >
                    <div className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${
                      !referenceMuted ? 'left-[17px] bg-[var(--bg-deep)]' : 'left-0.5 bg-[var(--text-muted)]'
                    }`} />
                  </button>
                </label>
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
                  <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-widest">Isolated Vocals</span>
                  <audio src={`/api/files/${refJobId}/vocals.wav`} controls className="w-full mt-1 h-8" preload="none" />
                </div>
                <div>
                  <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-widest">Instrumental</span>
                  <audio src={`/api/files/${refJobId}/instrumental.wav`} controls className="w-full mt-1 h-8" preload="none" />
                </div>
                <div className="text-[10px] font-mono text-[var(--text-muted)]">
                  Key: {detectedKey} · Melody notes: {melodyNotes.length} · Duration: {refDuration.toFixed(1)}s
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
