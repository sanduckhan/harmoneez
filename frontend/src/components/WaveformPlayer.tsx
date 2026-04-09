import { useEffect, useRef, useState, useCallback } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin, { type Region } from 'wavesurfer.js/dist/plugins/regions.js';

interface Props {
  audioUrl: string;
  onRegionChange?: (start: number | null, end: number | null) => void;
}

export function WaveformPlayer({ audioUrl, onRegionChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;

    const regions = RegionsPlugin.create();
    regionsRef.current = regions;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#6b7280',
      progressColor: '#8b5cf6',
      cursorColor: '#a855f7',
      height: 120,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      url: audioUrl,
      plugins: [regions],
    });

    wsRef.current = ws;

    ws.on('ready', () => {
      setDuration(ws.getDuration());
    });
    ws.on('timeupdate', (t) => setCurrentTime(t));
    ws.on('play', () => setPlaying(true));
    ws.on('pause', () => setPlaying(false));
    ws.on('finish', () => setPlaying(false));

    // Allow creating a region by dragging
    let regionCreated = false;
    regions.enableDragSelection({ color: 'rgba(139, 92, 246, 0.2)' });

    regions.on('region-created', (region: Region) => {
      // Only allow one region — remove previous ones
      if (regionCreated) {
        const allRegions = regions.getRegions();
        allRegions.forEach((r) => {
          if (r.id !== region.id) r.remove();
        });
      }
      regionCreated = true;
      onRegionChange?.(region.start, region.end);
    });

    regions.on('region-updated', (region: Region) => {
      onRegionChange?.(region.start, region.end);
    });

    return () => {
      ws.destroy();
    };
  }, [audioUrl]);

  const togglePlay = useCallback(() => {
    wsRef.current?.playPause();
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-3">
      <div ref={containerRef} className="rounded-lg overflow-hidden bg-gray-800/50" />
      <div className="flex items-center gap-4">
        <button
          onClick={togglePlay}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm font-medium transition-colors"
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <span className="text-sm text-gray-400 font-mono">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
        <span className="text-xs text-gray-500 ml-auto">
          Drag on the waveform to select a section
        </span>
      </div>
    </div>
  );
}
