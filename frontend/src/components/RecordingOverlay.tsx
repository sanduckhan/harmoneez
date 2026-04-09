import { useRef, useState, useCallback, useEffect } from 'react';
import { motion } from 'motion/react';
import { formatTime } from '../utils';

interface Props {
  onRecordingComplete: (blob: Blob) => void;
  onCancel: () => void;
  referenceAudioUrl?: string;
}

type RecordingState = 'idle' | 'recording' | 'review';

export function RecordingOverlay({ onRecordingComplete, onCancel, referenceAudioUrl }: Props) {
  const [state, setState] = useState<RecordingState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [referenceMuted, setReferenceMuted] = useState(false);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const referenceRef = useRef<HTMLAudioElement | null>(null);
  const reviewRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const animRef = useRef<number | null>(null);
  const blobRef = useRef<Blob | null>(null);

  // Mic level animation
  const updateLevel = useCallback(() => {
    if (analyserRef.current) {
      const data = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      setMicLevel(Math.min(1, rms * 4));
    }
    animRef.current = requestAnimationFrame(updateLevel);
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Set up analyser for level meter
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Start MediaRecorder
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        blobRef.current = blob;
        const url = URL.createObjectURL(blob);
        setRecordedUrl(url);
        setState('review');
      };
      mediaRecorderRef.current = recorder;
      recorder.start(100); // collect data every 100ms

      // Start reference playback
      if (referenceRef.current && referenceAudioUrl) {
        referenceRef.current.currentTime = 0;
        referenceRef.current.play();
      }

      // Start timer
      const startTime = Date.now();
      timerRef.current = window.setInterval(() => {
        setElapsed((Date.now() - startTime) / 1000);
      }, 100);

      // Start level meter
      animRef.current = requestAnimationFrame(updateLevel);

      setState('recording');
    } catch (err) {
      alert('Microphone access denied. Please allow microphone access in your browser settings.');
    }
  }, [referenceAudioUrl, updateLevel]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    referenceRef.current?.pause();
    if (timerRef.current) clearInterval(timerRef.current);
    if (animRef.current) cancelAnimationFrame(animRef.current);
    setMicLevel(0);
  }, []);

  const reRecord = useCallback(() => {
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    setRecordedUrl(null);
    setElapsed(0);
    blobRef.current = null;
    setState('idle');
  }, [recordedUrl]);

  const useTake = useCallback(() => {
    if (blobRef.current) {
      onRecordingComplete(blobRef.current);
    }
  }, [onRecordingComplete]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
      if (animRef.current) cancelAnimationFrame(animRef.current);
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    };
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] overflow-hidden"
    >
      {/* Reference audio (hidden) */}
      {referenceAudioUrl && (
        <audio
          ref={referenceRef}
          src={referenceAudioUrl}
          muted={referenceMuted}
          preload="auto"
        />
      )}

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--border)] bg-[var(--bg-surface)]">
        <div className={`w-2 h-2 rounded-full ${
          state === 'recording'
            ? 'bg-[var(--red)] shadow-[0_0_6px_var(--red)]'
            : 'bg-[var(--text-muted)]'
        }`} />
        <span className="text-xs font-mono text-[var(--text-muted)] uppercase tracking-widest">
          {state === 'idle' ? 'Ready to Record' : state === 'recording' ? 'Recording' : 'Review Take'}
        </span>
        <button
          onClick={onCancel}
          className="ml-auto text-[10px] font-mono text-[var(--text-muted)] hover:text-[var(--text-secondary)] uppercase tracking-wider"
        >
          Cancel
        </button>
      </div>

      <div className="p-6 space-y-6">
        {/* Mic level meter */}
        {(state === 'idle' || state === 'recording') && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-widest">Mic Level</span>
              {state === 'recording' && (
                <span className="font-mono text-sm text-[var(--red)] tabular-nums">
                  {formatTime(elapsed)}
                </span>
              )}
            </div>
            <div className="w-full h-3 bg-[var(--bg-surface)] rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{
                  width: `${micLevel * 100}%`,
                  background: micLevel > 0.8
                    ? 'var(--red)'
                    : micLevel > 0.5
                      ? 'var(--amber)'
                      : 'var(--teal)',
                }}
                transition={{ duration: 0.05 }}
              />
            </div>
          </div>
        )}

        {/* Reference track mute toggle */}
        {referenceAudioUrl && state !== 'review' && (
          <label className="flex items-center gap-3 cursor-pointer">
            <button
              onClick={() => {
                setReferenceMuted(!referenceMuted);
                if (referenceRef.current) referenceRef.current.muted = !referenceMuted;
              }}
              className={`
                relative w-10 h-5 rounded-full transition-all duration-200
                ${!referenceMuted
                  ? 'bg-[var(--amber)] shadow-[0_0_8px_var(--amber-glow)]'
                  : 'bg-[var(--bg-surface)] border border-[var(--border-highlight)]'}
              `}
            >
              <div className={`
                absolute top-0.5 w-4 h-4 rounded-full transition-all duration-200
                ${!referenceMuted
                  ? 'left-[22px] bg-[var(--bg-deep)]'
                  : 'left-0.5 bg-[var(--text-muted)]'}
              `} />
            </button>
            <span className="text-xs font-mono text-[var(--text-secondary)]">
              {referenceMuted ? 'Reference track muted' : 'Reference track playing'}
            </span>
          </label>
        )}

        {/* Review playback */}
        {state === 'review' && recordedUrl && (
          <div className="space-y-2">
            <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-widest">
              Recorded take ({formatTime(elapsed)})
            </span>
            <audio
              ref={reviewRef}
              src={recordedUrl}
              controls
              className="w-full h-10"
            />
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-3">
          {state === 'idle' && (
            <button
              onClick={startRecording}
              className="flex items-center gap-3 px-6 py-3 rounded-lg bg-[var(--red)] text-white font-mono uppercase tracking-wider text-sm hover:shadow-[0_0_20px_var(--red-glow)] transition-all"
            >
              <motion.div
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ repeat: Infinity, duration: 2 }}
                className="w-3 h-3 rounded-full bg-white"
              />
              Record
            </button>
          )}

          {state === 'recording' && (
            <button
              onClick={stopRecording}
              className="flex items-center gap-3 px-6 py-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-highlight)] text-[var(--text-primary)] font-mono uppercase tracking-wider text-sm hover:border-[var(--red)] transition-all"
            >
              <div className="w-3 h-3 rounded-sm bg-[var(--red)]" />
              Stop
            </button>
          )}

          {state === 'review' && (
            <>
              <button
                onClick={reRecord}
                className="px-4 py-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-highlight)] text-[var(--text-secondary)] font-mono uppercase tracking-wider text-xs hover:border-[var(--amber)]/50 transition-all"
              >
                Re-record
              </button>
              <button
                onClick={useTake}
                className="px-6 py-2.5 rounded-lg bg-[var(--amber)] text-[var(--bg-deep)] font-mono uppercase tracking-wider text-xs font-bold hover:shadow-[0_0_20px_var(--amber-glow)] transition-all"
              >
                Use This Take
              </button>
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}
