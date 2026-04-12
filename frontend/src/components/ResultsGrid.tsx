import { useState, useCallback } from 'react';
import { motion } from 'motion/react';
import type { IntervalFile } from '../types';
import { IntervalCard } from './IntervalCard';
import { downloadZip } from '../api';

interface Props {
  /** Job ID for zip download (optional — omit for persisted recordings). */
  jobId?: string;
  /** Harmony files to display. */
  files: IntervalFile[];
  /** Instrumental backing track URL (optional). */
  instrumentalUrl?: string;
  /** Custom download handler. If omitted, uses default downloadZip with jobId. */
  onDownload?: (intervals: string[]) => Promise<void>;
}

export function ResultsGrid({ jobId, files, instrumentalUrl, onDownload }: Props) {
  const [playingInterval, setPlayingInterval] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [withBacking, setWithBacking] = useState(false);

  const handlePlay = useCallback((interval: string) => {
    setPlayingInterval(interval);
  }, []);

  const handleStop = useCallback(() => {
    setPlayingInterval(null);
  }, []);

  const handleSelect = useCallback((interval: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(interval);
      else next.delete(interval);
      return next;
    });
  }, []);

  const canDownload = !!(jobId || onDownload);

  const handleDownload = useCallback(async () => {
    if (selected.size === 0) return;
    setDownloading(true);
    try {
      if (onDownload) {
        await onDownload(Array.from(selected));
      } else if (jobId) {
        await downloadZip(jobId, Array.from(selected));
      }
    } finally {
      setDownloading(false);
    }
  }, [jobId, selected, onDownload]);

  const selectAll = () => {
    setSelected(new Set(files.map((f) => f.interval)));
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-[var(--teal)] shadow-[0_0_6px_var(--teal)]" />
          <h2 className="text-sm font-mono uppercase tracking-widest text-[var(--text-secondary)]">
            Harmonies
          </h2>
        </div>
        <div className="flex items-center gap-4">
          {/* Instrumental backing toggle */}
          {instrumentalUrl && (
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                With Band
              </span>
              <button
                onClick={() => setWithBacking(!withBacking)}
                className={`
                  relative w-10 h-5 rounded-full transition-all duration-200
                  ${withBacking
                    ? 'bg-[var(--amber)] shadow-[0_0_8px_var(--amber-glow)]'
                    : 'bg-[var(--bg-surface)] border border-[var(--border-highlight)]'}
                `}
              >
                <div className={`
                  absolute top-0.5 w-4 h-4 rounded-full transition-all duration-200
                  ${withBacking
                    ? 'left-[22px] bg-[var(--bg-deep)]'
                    : 'left-0.5 bg-[var(--text-muted)]'}
                `} />
              </button>
            </label>
          )}

          <button
            onClick={selectAll}
            className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--amber)] transition-colors"
          >
            Select All
          </button>
          {canDownload && (
            <button
              onClick={handleDownload}
              disabled={selected.size === 0 || downloading}
              className={`
                px-4 py-1.5 rounded text-xs font-mono uppercase tracking-wider transition-all
                ${selected.size > 0
                  ? 'bg-[var(--amber)] text-[var(--bg-deep)] font-semibold hover:shadow-[0_0_12px_var(--amber-glow)]'
                  : 'bg-[var(--bg-surface)] text-[var(--text-muted)] border border-[var(--border)] cursor-not-allowed'}
              `}
            >
              {downloading ? 'Exporting...' : `Export ${selected.size > 0 ? `(${selected.size})` : ''}`}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {files.map((f, i) => (
          <IntervalCard
            key={f.interval}
            interval={f.interval}
            harmonyUrl={f.harmony_url}
            mixedUrl={f.mixed_url}
            instrumentalUrl={instrumentalUrl}
            withBacking={withBacking}
            isPlaying={playingInterval === f.interval}
            isSelected={selected.has(f.interval)}
            onPlay={handlePlay}
            onStop={handleStop}
            onSelect={handleSelect}
            index={i}
          />
        ))}
      </div>
    </motion.div>
  );
}
