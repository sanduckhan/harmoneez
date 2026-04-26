import { useCallback, useRef, useEffect } from 'react';
import type { FlowStep } from '../types';
import { formatTime } from '../utils';

interface Props {
  step: FlowStep;
  isPlaying: boolean;
  recordingPaused: boolean;
  currentTime: number;
  duration: number;
  vocalsOn: boolean;
  bandOn: boolean;
  selStart: number | null;
  selEnd: number | null;
  onPlay: () => void;
  onPause: () => void;
  onSeekToStart: () => void;
  onSeek: (time: number) => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onPauseRecording: () => void;
  onResumeRecording: () => void;
  onReRecord: () => void;
  onToggleVocals: () => void;
  onToggleBand: () => void;
  onGenerateHarmonies: () => void;
  pitchCorrect: boolean;
  onTogglePitchCorrect: () => void;
  harmonyInTune: boolean;
  onToggleHarmonyInTune: () => void;
  monitorOn: boolean;
  onToggleMonitor: () => void;
}

export function TransportBar({
  step, isPlaying, recordingPaused, currentTime, duration,
  vocalsOn, bandOn, selStart, selEnd,
  onPlay, onPause, onSeekToStart, onSeek,
  onStartRecording, onStopRecording, onPauseRecording, onResumeRecording,
  onReRecord, onToggleVocals, onToggleBand, onGenerateHarmonies,
  pitchCorrect, onTogglePitchCorrect,
  harmonyInTune, onToggleHarmonyInTune,
  monitorOn, onToggleMonitor,
}: Props) {
  const scrubRef = useRef<HTMLDivElement>(null);
  const isDraggingScrub = useRef(false);
  const cleanupDragRef = useRef<(() => void) | null>(null);

  // Clean up drag listeners on unmount
  useEffect(() => {
    return () => { cleanupDragRef.current?.(); };
  }, []);

  const seekFromEvent = useCallback((e: React.MouseEvent | MouseEvent) => {
    if (!scrubRef.current || step === 'recording') return;
    const rect = scrubRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(pct * duration);
  }, [duration, onSeek, step]);

  const handleScrubDown = useCallback((e: React.MouseEvent) => {
    if (step === 'recording') return;
    isDraggingScrub.current = true;
    seekFromEvent(e);

    const onMove = (ev: MouseEvent) => {
      if (isDraggingScrub.current) seekFromEvent(ev);
    };
    const onUp = () => {
      isDraggingScrub.current = false;
      cleanupDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    cleanupDragRef.current = onUp;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [seekFromEvent, step]);

  const handlePlayPause = useCallback(() => {
    if (step === 'recording') {
      if (recordingPaused) onResumeRecording();
      else onPauseRecording();
    } else {
      if (isPlaying) onPause();
      else onPlay();
    }
  }, [step, isPlaying, recordingPaused, onPlay, onPause, onPauseRecording, onResumeRecording]);

  const handleRecord = useCallback(() => {
    if (step === 'guide') onStartRecording();
    else if (step === 'recording') onStopRecording();
    else if (step === 'review') onReRecord();
  }, [step, onStartRecording, onStopRecording, onReRecord]);

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const isRecording = step === 'recording';
  const isReview = step === 'review';

  return (
    <div className="bg-[var(--bg-surface)] border-t border-[var(--border)]">
      {/* Scrub bar */}
      <div
        ref={scrubRef}
        onMouseDown={handleScrubDown}
        className={`w-full h-2 bg-[var(--border)] ${step === 'recording' ? 'cursor-default' : 'cursor-pointer'} group relative`}
      >
        {/* Selection overlay */}
        {selStart !== null && selEnd !== null && duration > 0 && (
          <div
            className="absolute top-0 h-full bg-[var(--amber)] opacity-20"
            style={{
              left: `${(Math.min(selStart, selEnd) / duration) * 100}%`,
              width: `${((Math.abs(selEnd - selStart)) / duration) * 100}%`,
            }}
          />
        )}
        {/* Progress fill */}
        <div
          className={`h-full rounded-r-sm transition-[width] duration-75 ${isRecording ? 'bg-[var(--red)]' : 'bg-[var(--amber)]'}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
        {/* Thumb */}
        {duration > 0 && (
          <div
            className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full opacity-0 group-hover:opacity-100 transition-opacity ${isRecording ? 'bg-[var(--red)]' : 'bg-[var(--amber)]'}`}
            style={{ left: `calc(${Math.min(100, pct)}% - 6px)` }}
          />
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 px-4 py-2">
        {/* Skip to start */}
        <button
          onClick={onSeekToStart}
          disabled={isRecording}
          className="w-8 h-8 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30 transition-colors"
          title="Skip to start (Cmd+Left)"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="1" y="2" width="2" height="10" fill="currentColor" />
            <path d="M12 2L5 7L12 12V2Z" fill="currentColor" />
          </svg>
        </button>

        {/* Play/Pause */}
        <button
          onClick={handlePlayPause}
          className="w-10 h-10 flex items-center justify-center rounded-lg bg-[var(--bg-surface)] border border-[var(--border-highlight)] hover:border-[var(--amber)]/50 text-[var(--text-primary)] transition-all"
          title="Play/Pause (Space)"
        >
          {(isPlaying && !isRecording) || (isRecording && !recordingPaused) ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="2" y="1" width="3.5" height="12" rx="1" fill="currentColor" />
              <rect x="8.5" y="1" width="3.5" height="12" rx="1" fill="currentColor" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 1L12 7L3 13V1Z" fill="currentColor" />
            </svg>
          )}
        </button>

        {/* Record */}
        <button
          onClick={handleRecord}
          className={`w-10 h-10 flex items-center justify-center rounded-lg border transition-all ${
            isRecording
              ? 'bg-[var(--red)]/20 border-[var(--red)] text-[var(--red)]'
              : isReview
                ? 'bg-[var(--bg-surface)] border-[var(--border-highlight)] text-[var(--text-muted)] hover:border-[var(--red)]/50 hover:text-[var(--red)]'
                : 'bg-[var(--bg-surface)] border-[var(--border-highlight)] text-[var(--red)] hover:border-[var(--red)]/50'
          }`}
          title={isRecording ? 'Stop (Escape)' : isReview ? 'Re-record (R)' : 'Record (R)'}
        >
          {isRecording ? (
            <div className="w-3 h-3 rounded-sm bg-[var(--red)]" />
          ) : (
            <div className="w-3.5 h-3.5 rounded-full bg-current" />
          )}
        </button>

        {/* Monitor toggle — available before AND during recording so users
            can confirm their headphones work before pressing record */}
        {(step === 'guide' || isRecording) && (
          <button
            onClick={onToggleMonitor}
            className={`w-9 h-9 flex items-center justify-center rounded-lg border transition-all ${
              monitorOn
                ? 'bg-[var(--amber)]/15 border-[var(--amber)]/40 text-[var(--amber)]'
                : 'bg-[var(--bg-surface)] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
            title={monitorOn ? 'Stop monitoring (use headphones to avoid feedback)' : 'Hear yourself (use headphones)'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H4a1 1 0 0 1-1-1v-6a9 9 0 0 1 18 0v6a1 1 0 0 1-1 1h-2a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" />
            </svg>
          </button>
        )}

        {/* Time */}
        <div className="flex items-center gap-1 font-mono text-xs tabular-nums min-w-[100px]">
          <span className={isRecording ? 'text-[var(--red)]' : 'text-[var(--amber)]'}>{formatTime(currentTime)}</span>
          <span className="text-[var(--text-muted)]">/</span>
          <span className="text-[var(--text-secondary)]">{formatTime(duration)}</span>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Pitch correct toggle (review only) */}
        {isReview && (
          <label
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer text-[11px] font-mono uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors select-none"
            title="Apply pitch correction to recorded vocal before harmonizing"
          >
            <input
              type="checkbox"
              checked={pitchCorrect}
              onChange={onTogglePitchCorrect}
              className="w-3.5 h-3.5 accent-[var(--amber)] cursor-pointer"
            />
            Pitch correct
          </label>
        )}

        {/* In-tune harmony toggle (review only) */}
        {isReview && (
          <label
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer text-[11px] font-mono uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors select-none"
            title="Lock harmony to scale even if your lead drifts in pitch"
          >
            <input
              type="checkbox"
              checked={harmonyInTune}
              onChange={onToggleHarmonyInTune}
              className="w-3.5 h-3.5 accent-[var(--amber)] cursor-pointer"
            />
            In-tune harmony
          </label>
        )}

        {/* Generate (review only) */}
        {isReview && (
          <button
            onClick={onGenerateHarmonies}
            className="px-4 py-1.5 rounded-lg bg-[var(--amber)] text-[var(--bg-deep)] font-mono uppercase tracking-wider text-[11px] font-bold hover:shadow-[0_0_20px_var(--amber-glow)] transition-all"
          >
            {selStart !== null ? `Generate ${formatTime(selStart)}-${formatTime(selEnd!)}` : 'Generate All'}
          </button>
        )}

        {/* Selection hint (review only) */}
        {isReview && (
          <span className="text-[10px] font-mono text-[var(--text-muted)]">
            {selStart !== null ? 'Esc to clear' : 'Drag to select'}
          </span>
        )}

        {/* Stem toggles */}
        <div className="flex items-center gap-1">
          <button
            onClick={onToggleVocals}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-mono uppercase tracking-wider transition-all ${
              vocalsOn
                ? 'bg-[var(--amber)]/15 border-[var(--amber)]/40 text-[var(--amber)]'
                : 'bg-[var(--bg-surface)] border-[var(--border)] text-[var(--text-muted)] opacity-50'
            }`}
            title={vocalsOn ? 'Mute vocals' : 'Unmute vocals'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
            {!vocalsOn && (
              <svg width="10" height="10" viewBox="0 0 14 14" className="text-[var(--red)]">
                <line x1="1" y1="1" x2="13" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            )}
          </button>
          <button
            onClick={onToggleBand}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-mono uppercase tracking-wider transition-all ${
              bandOn
                ? 'bg-[var(--amber)]/15 border-[var(--amber)]/40 text-[var(--amber)]'
                : 'bg-[var(--bg-surface)] border-[var(--border)] text-[var(--text-muted)] opacity-50'
            }`}
            title={bandOn ? 'Mute band' : 'Unmute band'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
            {!bandOn && (
              <svg width="10" height="10" viewBox="0 0 14 14" className="text-[var(--red)]">
                <line x1="1" y1="1" x2="13" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
