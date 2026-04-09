import { useEffect, useRef } from 'react';
import type { PitchFrame } from '../api';

interface Props {
  pitchData: PitchFrame[];
  duration: number;
}

const TEAL = '#2dd4a8';
const AMBER = '#f5a623';
const RED = '#ef4444';
const SURFACE = '#141420';

function deviationToColor(cents: number | null): string {
  if (cents === null) return SURFACE;
  const abs = Math.abs(cents);
  if (abs < 20) return TEAL;
  if (abs < 40) return AMBER;
  return RED;
}

export function PitchBar({ pitchData, duration }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || pitchData.length === 0 || duration <= 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.offsetWidth;
    const height = 20;
    canvas.width = width * window.devicePixelRatio;
    canvas.height = height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    // Clear
    ctx.fillStyle = SURFACE;
    ctx.fillRect(0, 0, width, height);

    // Draw each frame as a column
    for (const frame of pitchData) {
      const x = (frame.time / duration) * width;
      const color = deviationToColor(frame.deviation_cents);
      ctx.fillStyle = color;
      ctx.fillRect(Math.floor(x), 0, Math.max(1, width / pitchData.length + 1), height);
    }
  }, [pitchData, duration]);

  if (pitchData.length === 0) return null;

  return (
    <div className="px-1">
      <canvas
        ref={canvasRef}
        className="w-full rounded-sm"
        style={{ height: '20px' }}
        title="Pitch accuracy: green = in tune, amber = slightly off, red = off"
      />
      <div className="flex items-center gap-3 mt-1 px-1">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full" style={{ background: TEAL }} />
          <span className="text-[9px] font-mono text-[var(--text-muted)]">&lt;20c</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full" style={{ background: AMBER }} />
          <span className="text-[9px] font-mono text-[var(--text-muted)]">20-40c</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full" style={{ background: RED }} />
          <span className="text-[9px] font-mono text-[var(--text-muted)]">&gt;40c</span>
        </div>
      </div>
    </div>
  );
}
