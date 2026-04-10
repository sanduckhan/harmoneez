import { useEffect, useRef, useCallback, useState } from 'react';
import type { MelodyNote, PitchSample } from '../types';

export type CanvasMode = 'guide' | 'recording' | 'review';

interface Props {
  melodyNotes: MelodyNote[];
  pitchSamplesRef: React.RefObject<PitchSample[]>;
  currentTime: number;
  duration: number;
  mode: CanvasMode;
  isPlaying: boolean;
  onScrub?: (time: number) => void;
  onRegionSelect?: (start: number, end: number) => void;
  className?: string;
}

const MARGIN_LEFT = 44;
const MARGIN_BOTTOM = 24;
const DEFAULT_VISIBLE_SECONDS = 12;
const NOW_FRACTION = 0.7;

const BG = '#06060a';
const GRID_MAJOR = 'rgba(42, 42, 64, 0.5)';
const GRID_MINOR = 'rgba(30, 30, 48, 0.25)';
const AMBER = '#f5a623';
const AMBER_DIM = 'rgba(245, 166, 35, 0.25)';
const AMBER_GLOW = 'rgba(245, 166, 35, 0.08)';
const TEAL = '#2dd4a8';
const RED = '#ef4444';
const TEXT_MUTED = '#4a4660';
const SELECTION = 'rgba(245, 166, 35, 0.12)';

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

function computePitchRange(notes: MelodyNote[]) {
  if (notes.length === 0) return { minMidi: 57, maxMidi: 69 };
  let min = Infinity, max = -Infinity;
  for (const n of notes) {
    if (n.midi_pitch < min) min = n.midi_pitch;
    if (n.midi_pitch > max) max = n.midi_pitch;
  }
  return { minMidi: min - 3, maxMidi: max + 3 };
}

// Binary search for the active melody note at a given time
function findActiveNote(notes: MelodyNote[], time: number): MelodyNote | null {
  let lo = 0, hi = notes.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].end_sec < time) lo = mid + 1;
    else if (notes[mid].start_sec > time) hi = mid - 1;
    else return notes[mid];
  }
  return null;
}

function deviationColor(notes: MelodyNote[], time: number, userMidi: number): string {
  const note = findActiveNote(notes, time);
  if (!note) return 'rgba(139, 135, 160, 0.4)';
  const cents = Math.abs(userMidi - note.midi_pitch) * 100;
  if (cents < 20) return TEAL;
  if (cents < 40) return AMBER;
  return RED;
}

export function PitchCanvas({
  melodyNotes, pitchSamplesRef, currentTime, duration,
  mode, isPlaying, onScrub, onRegionSelect, className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const visSecsRef = useRef(DEFAULT_VISIBLE_SECONDS);
  const pitchRange = useRef(computePitchRange(melodyNotes));
  const isDragging = useRef(false);

  // Store mutable values in refs to avoid effect dependency cascades
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  const selStartRef = useRef<number | null>(null);
  const selEndRef = useRef<number | null>(null);
  const [, forceRender] = useState(0); // trigger re-render only when selection finalizes
  const onScrubRef = useRef(onScrub);
  onScrubRef.current = onScrub;
  const onRegionSelectRef = useRef(onRegionSelect);
  onRegionSelectRef.current = onRegionSelect;

  useEffect(() => {
    pitchRange.current = computePitchRange(melodyNotes);
    console.log(`[PitchCanvas] melodyNotes: ${melodyNotes.length}, range: ${pitchRange.current.minMidi}-${pitchRange.current.maxMidi}`);
  }, [melodyNotes]);

  const render = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const t = currentTimeRef.current;
    const DRAW_W = w - MARGIN_LEFT;
    const DRAW_H = h - MARGIN_BOTTOM;
    const VIS = visSecsRef.current;
    const windowStart = t - VIS * NOW_FRACTION;
    const windowEnd = t + VIS * (1 - NOW_FRACTION);
    const { minMidi, maxMidi } = pitchRange.current;
    const midiRange = maxMidi - minMidi || 1;

    const timeToX = (sec: number) => MARGIN_LEFT + ((sec - windowStart) / VIS) * DRAW_W;
    const midiToY = (midi: number) => DRAW_H - ((midi - minMidi) / midiRange) * DRAW_H;

    // 1. Clear
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);

    // 2. Semitone grid
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let midi = Math.ceil(minMidi); midi <= Math.floor(maxMidi); midi++) {
      const y = midiToY(midi);
      const noteIdx = ((midi % 12) + 12) % 12;
      const isNatural = [0, 2, 4, 5, 7, 9, 11].includes(noteIdx);

      ctx.beginPath();
      ctx.strokeStyle = isNatural ? GRID_MAJOR : GRID_MINOR;
      ctx.lineWidth = isNatural ? 0.8 : 0.4;
      ctx.moveTo(MARGIN_LEFT, y);
      ctx.lineTo(w, y);
      ctx.stroke();

      if (isNatural) {
        const octave = Math.floor(midi / 12) - 1;
        ctx.fillStyle = TEXT_MUTED;
        ctx.fillText(`${NOTE_NAMES[noteIdx]}${octave}`, MARGIN_LEFT - 4, y);
      }
    }

    // 3. Time markers
    const startSec = Math.floor(Math.max(0, windowStart));
    const endSec = Math.ceil(Math.min(duration, windowEnd));
    ctx.font = '8px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = TEXT_MUTED;
    for (let s = startSec; s <= endSec; s++) {
      if (s % 2 !== 0) continue;
      const x = timeToX(s);
      if (x < MARGIN_LEFT || x > w) continue;
      const m = Math.floor(s / 60);
      const sec = s % 60;
      ctx.fillText(`${m}:${sec.toString().padStart(2, '0')}`, x, h - 6);
    }

    // 4. Selection overlay
    const ss = selStartRef.current;
    const se = selEndRef.current;
    if (ss !== null && se !== null) {
      const sx = timeToX(Math.min(ss, se));
      const ex = timeToX(Math.max(ss, se));
      ctx.fillStyle = SELECTION;
      ctx.fillRect(sx, 0, ex - sx, DRAW_H);
      ctx.strokeStyle = AMBER;
      ctx.lineWidth = 1;
      ctx.strokeRect(sx, 0, ex - sx, DRAW_H);
    }

    // 5. Melody guide
    const noteH = Math.max(6, (DRAW_H / midiRange) * 0.5);
    ctx.fillStyle = AMBER_DIM;
    ctx.strokeStyle = 'rgba(245, 166, 35, 0.5)';
    ctx.lineWidth = 1;

    for (const note of melodyNotes) {
      const x1 = timeToX(note.start_sec);
      const x2 = timeToX(note.end_sec);
      if (x2 < MARGIN_LEFT || x1 > w) continue;
      const y = midiToY(note.midi_pitch);
      const nw = Math.max(2, x2 - x1);
      ctx.beginPath();
      ctx.roundRect(x1, y - noteH / 2, nw, noteH, 2);
      ctx.fill();
      ctx.stroke();
    }

    // 6. User pitch trail
    const samples = pitchSamplesRef.current;
    if (samples && samples.length > 1) {
      let lo = 0, hi = samples.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (samples[mid].time < windowStart - 0.5) lo = mid + 1;
        else hi = mid;
      }

      for (let i = Math.max(lo, 1); i < samples.length; i++) {
        const prev = samples[i - 1];
        const curr = samples[i];
        if (curr.time > windowEnd + 0.5) break;
        if (prev.midi === null || curr.midi === null) continue;
        if (curr.time - prev.time > 0.15) continue;

        ctx.beginPath();
        ctx.strokeStyle = deviationColor(melodyNotes, curr.time, curr.midi);
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.moveTo(timeToX(prev.time), midiToY(prev.midi));
        ctx.lineTo(timeToX(curr.time), midiToY(curr.midi));
        ctx.stroke();
      }
    }

    // 7. Now-marker
    const nowX = MARGIN_LEFT + DRAW_W * NOW_FRACTION;
    const grad = ctx.createLinearGradient(nowX - 30, 0, nowX + 30, 0);
    grad.addColorStop(0, 'rgba(245, 166, 35, 0)');
    grad.addColorStop(0.5, AMBER_GLOW);
    grad.addColorStop(1, 'rgba(245, 166, 35, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(nowX - 30, 0, 60, DRAW_H);
    ctx.beginPath();
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 2;
    ctx.moveTo(nowX, 0);
    ctx.lineTo(nowX, DRAW_H);
    ctx.stroke();
  }, [melodyNotes, duration]);

  // Animation loop — stable effect, reads from refs
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    };
    resize();
    const obs = new ResizeObserver(resize);
    obs.observe(canvas);

    let running = true;
    const loop = () => {
      if (!running) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const rect = canvas.getBoundingClientRect();
      ctx.save();
      ctx.scale(dpr, dpr);
      render(ctx, rect.width, rect.height);
      ctx.restore();

      if (isPlaying || isDragging.current) {
        animRef.current = requestAnimationFrame(loop);
      }
    };

    // Draw once immediately
    requestAnimationFrame(loop);

    return () => {
      running = false;
      cancelAnimationFrame(animRef.current);
      obs.disconnect();
    };
  }, [isPlaying, render]);

  // Redraw when paused and currentTime changes (e.g. scrubbing)
  useEffect(() => {
    if (isPlaying) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    ctx.save();
    ctx.scale(dpr, dpr);
    render(ctx, rect.width, rect.height);
    ctx.restore();
  }, [currentTime, isPlaying, render]);

  // Mouse handlers — read from refs to avoid dependency cascades
  const getTimeFromX = useCallback((clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const DRAW_W = rect.width - MARGIN_LEFT;
    const VIS = visSecsRef.current;
    const windowStart = currentTimeRef.current - VIS * NOW_FRACTION;
    return windowStart + ((x - MARGIN_LEFT) / DRAW_W) * VIS;
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (mode !== 'review') return;
    isDragging.current = true;
    const t = getTimeFromX(e.clientX);
    if (e.shiftKey) {
      selStartRef.current = t;
      selEndRef.current = t;
    } else {
      onScrubRef.current?.(Math.max(0, Math.min(duration, t)));
    }
  }, [mode, getTimeFromX, duration]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current || mode !== 'review') return;
    const t = getTimeFromX(e.clientX);
    if (selStartRef.current !== null) {
      selEndRef.current = t;
      // Trigger redraw
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const dpr = window.devicePixelRatio || 1;
          const rect = canvas.getBoundingClientRect();
          ctx.save();
          ctx.scale(dpr, dpr);
          render(ctx, rect.width, rect.height);
          ctx.restore();
        }
      }
    } else {
      onScrubRef.current?.(Math.max(0, Math.min(duration, t)));
    }
  }, [mode, getTimeFromX, duration, render]);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
    const ss = selStartRef.current;
    const se = selEndRef.current;
    if (ss !== null && se !== null) {
      const s = Math.min(ss, se);
      const e = Math.max(ss, se);
      if (e - s > 0.5) {
        onRegionSelectRef.current?.(s, e);
        forceRender(n => n + 1);
      }
    }
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (mode !== 'review') return;
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.15 : 0.87;
    visSecsRef.current = Math.max(4, Math.min(duration, visSecsRef.current * factor));
  }, [mode, duration]);

  return (
    <canvas
      ref={canvasRef}
      className={`w-full rounded-lg ${className || ''}`}
      style={{ height: '280px', cursor: mode === 'review' ? 'crosshair' : 'default' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
    />
  );
}
