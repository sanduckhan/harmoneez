import { useEffect, useRef, useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { formatTime } from '../utils';
import type { PitchFrame } from '../api';
import { PitchBar } from './PitchBar';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin, { type Region } from 'wavesurfer.js/dist/plugins/regions.js';

interface Props {
  audioUrl: string;
  onRegionChange?: (start: number | null, end: number | null) => void;
  pitchData?: PitchFrame[];
}

export function WaveformPlayer({ audioUrl, onRegionChange, pitchData }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;

    const regions = RegionsPlugin.create();

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#4a4660',
      progressColor: '#f5a623',
      cursorColor: '#f5a623',
      cursorWidth: 1,
      height: 100,
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      url: audioUrl,
      plugins: [regions],
    });

    wsRef.current = ws;

    ws.on('ready', () => setDuration(ws.getDuration()));
    ws.on('timeupdate', (t) => setCurrentTime(t));
    ws.on('play', () => setPlaying(true));
    ws.on('pause', () => setPlaying(false));
    ws.on('finish', () => setPlaying(false));

    let regionCreated = false;
    regions.enableDragSelection({ color: 'rgba(245, 166, 35, 0.12)' });

    regions.on('region-created', (region: Region) => {
      if (regionCreated) {
        regions.getRegions().forEach((r) => {
          if (r.id !== region.id) r.remove();
        });
      }
      regionCreated = true;
      onRegionChange?.(region.start, region.end);
    });

    regions.on('region-updated', (region: Region) => {
      onRegionChange?.(region.start, region.end);
    });

    return () => { ws.destroy(); };
  }, [audioUrl]);

  const togglePlay = useCallback(() => {
    wsRef.current?.playPause();
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] overflow-hidden"
    >
      {/* Channel strip header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--border)] bg-[var(--bg-surface)]">
        <div className={`w-2 h-2 rounded-full ${playing ? 'bg-[var(--teal)] shadow-[0_0_6px_var(--teal)]' : 'bg-[var(--text-muted)]'}`} />
        <span className="text-xs font-mono text-[var(--text-muted)] uppercase tracking-widest">Waveform</span>
        <span className="text-xs text-[var(--text-muted)] ml-auto">drag to select section</span>
      </div>

      {/* Waveform */}
      <div ref={containerRef} className="px-1 py-3" />

      {/* Pitch accuracy bar */}
      {pitchData && pitchData.length > 0 && (
        <PitchBar pitchData={pitchData} duration={duration} />
      )}

      {/* Transport controls */}
      <div className="flex items-center gap-4 px-4 py-3 border-t border-[var(--border)]">
        <button
          onClick={togglePlay}
          className="flex items-center gap-2 px-4 py-1.5 rounded bg-[var(--bg-surface)] border border-[var(--border-highlight)] hover:border-[var(--amber)] hover:shadow-[0_0_12px_var(--amber-glow)] transition-all text-sm font-mono"
        >
          {playing ? (
            <>
              <span className="w-3 h-3 border-l-2 border-r-2 border-[var(--amber)]" />
              <span className="text-[var(--amber)]">PAUSE</span>
            </>
          ) : (
            <>
              <span className="w-0 h-0 border-l-[8px] border-l-[var(--amber)] border-y-[5px] border-y-transparent" />
              <span className="text-[var(--text-secondary)]">PLAY</span>
            </>
          )}
        </button>

        <span className="font-mono text-sm text-[var(--amber)] tabular-nums">
          {formatTime(currentTime)}
        </span>
        <span className="font-mono text-sm text-[var(--text-muted)]">/</span>
        <span className="font-mono text-sm text-[var(--text-secondary)] tabular-nums">
          {formatTime(duration)}
        </span>
      </div>
    </motion.div>
  );
}
