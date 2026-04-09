import { useState, useCallback } from 'react';
import type { PipelineResult } from '../types';
import { IntervalCard } from './IntervalCard';
import { downloadZip } from '../api';

interface Props {
  jobId: string;
  result: PipelineResult;
}

export function ResultsGrid({ jobId, result }: Props) {
  const [playingInterval, setPlayingInterval] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);

  const handlePlay = useCallback((interval: string) => {
    // Stop any currently playing audio
    document.querySelectorAll('audio').forEach((a) => {
      a.pause();
      a.currentTime = 0;
    });
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

  const handleDownload = useCallback(async () => {
    if (selected.size === 0) return;
    setDownloading(true);
    try {
      await downloadZip(jobId, Array.from(selected));
    } finally {
      setDownloading(false);
    }
  }, [jobId, selected]);

  const selectAll = () => {
    setSelected(new Set(result.files.map((f) => f.interval)));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Results</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={selectAll}
            className="text-xs text-purple-400 hover:text-purple-300"
          >
            Select all
          </button>
          <button
            onClick={handleDownload}
            disabled={selected.size === 0 || downloading}
            className={`
              px-4 py-1.5 rounded text-sm font-medium transition-colors
              ${selected.size > 0
                ? 'bg-purple-600 hover:bg-purple-500'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'}
            `}
          >
            {downloading ? 'Downloading...' : `Download (${selected.size})`}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {result.files.map((f) => (
          <IntervalCard
            key={f.interval}
            interval={f.interval}
            harmonyUrl={f.harmony_url}
            mixedUrl={f.mixed_url}
            isPlaying={playingInterval === f.interval}
            isSelected={selected.has(f.interval)}
            onPlay={handlePlay}
            onStop={handleStop}
            onSelect={handleSelect}
          />
        ))}
      </div>
    </div>
  );
}
