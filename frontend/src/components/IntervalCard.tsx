import { useRef, useState, useCallback, useEffect } from 'react';
import { motion } from 'motion/react';

interface Props {
  interval: string;
  harmonyUrl: string;
  mixedUrl: string;
  instrumentalUrl?: string;
  withBacking?: boolean;
  isPlaying: boolean;
  isSelected: boolean;
  onPlay: (interval: string) => void;
  onStop: () => void;
  onSelect: (interval: string, selected: boolean) => void;
  index: number;
}

const INTERVAL_META: Record<string, { label: string; shortLabel: string; description: string }> = {
  '3rd-above': { label: '3rd Above', shortLabel: '3', description: 'Classic harmony' },
  '3rd-below': { label: '3rd Below', shortLabel: '3', description: 'Lower harmony' },
  '5th': { label: '5th', shortLabel: '5', description: 'Power harmony' },
  '6th': { label: '6th', shortLabel: '6', description: 'Wide interval' },
  'octave': { label: 'Octave', shortLabel: '8', description: 'Doubling up' },
  'unison': { label: 'Unison', shortLabel: 'U', description: 'Vocal thickener' },
  'drone-root': { label: 'Drone Root', shortLabel: 'DR', description: 'Hold root note' },
  'drone-5th': { label: 'Drone 5th', shortLabel: 'D5', description: 'Hold 5th note' },
};

export function IntervalCard({
  interval, harmonyUrl, mixedUrl, instrumentalUrl, withBacking,
  isPlaying, isSelected, onPlay, onStop, onSelect, index,
}: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const backingRef = useRef<HTMLAudioElement | null>(null);
  const [mode, setMode] = useState<'mixed' | 'harmony'>('mixed');
  const meta = INTERVAL_META[interval] || { label: interval, shortLabel: '?', description: '' };

  useEffect(() => {
    if (!isPlaying) {
      audioRef.current?.pause();
      if (audioRef.current) audioRef.current.currentTime = 0;
      backingRef.current?.pause();
      if (backingRef.current) backingRef.current.currentTime = 0;
    }
  }, [isPlaying]);

  const handlePlay = useCallback(() => {
    if (isPlaying) {
      audioRef.current?.pause();
      backingRef.current?.pause();
      onStop();
    } else {
      onPlay(interval);
      const url = mode === 'mixed' ? mixedUrl : harmonyUrl;
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.play();
      }
      if (withBacking && instrumentalUrl && backingRef.current) {
        backingRef.current.src = instrumentalUrl;
        backingRef.current.play();
      }
    }
  }, [isPlaying, interval, mode, mixedUrl, harmonyUrl, instrumentalUrl, withBacking, onPlay, onStop]);

  // Sync backing when withBacking changes during playback
  useEffect(() => {
    if (isPlaying && backingRef.current) {
      if (withBacking && instrumentalUrl) {
        backingRef.current.src = instrumentalUrl;
        backingRef.current.currentTime = audioRef.current?.currentTime || 0;
        backingRef.current.play();
      } else {
        backingRef.current.pause();
      }
    }
  }, [withBacking]);

  const handleModeSwitch = useCallback((newMode: 'mixed' | 'harmony') => {
    setMode(newMode);
    if (isPlaying && audioRef.current) {
      const currentTime = audioRef.current.currentTime;
      audioRef.current.src = newMode === 'mixed' ? mixedUrl : harmonyUrl;
      audioRef.current.currentTime = currentTime;
      audioRef.current.play();
    }
  }, [isPlaying, mixedUrl, harmonyUrl]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className={`
        relative rounded-lg border transition-all duration-200
        ${isPlaying
          ? 'border-[var(--amber)] bg-[var(--amber-glow)] shadow-[0_0_20px_var(--amber-glow)]'
          : 'border-[var(--border)] bg-[var(--bg-panel)] hover:border-[var(--border-highlight)]'}
        ${isSelected ? 'ring-1 ring-[var(--amber)]/50' : ''}
      `}
    >
      <audio ref={audioRef} onEnded={onStop} preload="none" />
      <audio ref={backingRef} preload="none" />

      {/* Header */}
      <div className="flex items-start justify-between p-3 pb-0">
        <div>
          <h3 className="font-mono text-sm font-semibold text-[var(--text-primary)]">
            {meta.label}
          </h3>
          <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{meta.description}</p>
        </div>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => onSelect(interval, e.target.checked)}
          className="mt-0.5"
        />
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 p-3">
        <button
          onClick={handlePlay}
          className={`
            flex items-center justify-center w-8 h-8 rounded transition-all
            ${isPlaying
              ? 'bg-[var(--amber)] text-[var(--bg-deep)]'
              : 'bg-[var(--bg-surface)] border border-[var(--border-highlight)] hover:border-[var(--amber)]/50 text-[var(--text-secondary)]'}
          `}
        >
          {isPlaying ? (
            <span className="w-3 h-3 border-l-2 border-r-2 border-current" />
          ) : (
            <span className="w-0 h-0 ml-0.5 border-l-[7px] border-l-current border-y-[5px] border-y-transparent" />
          )}
        </button>

        <div className="flex bg-[var(--bg-surface)] rounded border border-[var(--border)] text-[10px] font-mono overflow-hidden">
          <button
            onClick={() => handleModeSwitch('mixed')}
            className={`px-2.5 py-1 transition-all ${
              mode === 'mixed'
                ? 'bg-[var(--amber)] text-[var(--bg-deep)] font-semibold'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            MIX
          </button>
          <button
            onClick={() => handleModeSwitch('harmony')}
            className={`px-2.5 py-1 transition-all ${
              mode === 'harmony'
                ? 'bg-[var(--amber)] text-[var(--bg-deep)] font-semibold'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            SOLO
          </button>
        </div>
      </div>
    </motion.div>
  );
}
