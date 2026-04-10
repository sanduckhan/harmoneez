import { useEffect, useRef, useCallback, useState } from 'react';
import type { MelodyNote, PitchSample } from '../types';

export type CanvasMode = 'guide' | 'recording' | 'review';

export interface AmplitudeEnvelope {
  sr: number;
  hop: number;
  envelope: number[];
}

export interface PitchContour {
  frame_duration: number;
  contour: (number | null)[];
}

interface Props {
  melodyNotes: MelodyNote[];
  pitchSamplesRef: React.RefObject<PitchSample[]>;
  getTime: () => number;
  duration: number;
  mode: CanvasMode;
  isPlaying: boolean;
  scalePitchClasses?: number[];
  amplitude?: AmplitudeEnvelope | null;
  pitchContour?: PitchContour | null;  // continuous pitch line from WORLD
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
const IN_KEY_ROW = 'rgba(245, 166, 35, 0.04)';  // subtle highlight for in-key rows
const AMBER_GLOW = 'rgba(245, 166, 35, 0.08)';
const TEAL = '#2dd4a8';
const RED = '#ef4444';
const TEXT_MUTED = '#4a4660';
const SELECTION = 'rgba(245, 166, 35, 0.12)';

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

function computePitchRange(notes: MelodyNote[]) {
  if (notes.length === 0) return { minMidi: 57, maxMidi: 69 };
  // Filter to vocal range (C2=36 to C6=84) to ignore noise detections
  const vocalNotes = notes.filter(n => n.midi_pitch >= 36 && n.midi_pitch <= 84);
  if (vocalNotes.length === 0) return { minMidi: 57, maxMidi: 69 };
  let min = Infinity, max = -Infinity;
  for (const n of vocalNotes) {
    if (n.midi_pitch < min) min = n.midi_pitch;
    if (n.midi_pitch > max) max = n.midi_pitch;
  }
  return { minMidi: min - 2, maxMidi: max + 2 };
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
  melodyNotes, pitchSamplesRef, getTime, duration,
  mode, isPlaying, scalePitchClasses, amplitude, pitchContour, onScrub, onRegionSelect, className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const visSecsRef = useRef(DEFAULT_VISIBLE_SECONDS);
  const pitchRange = useRef(computePitchRange(melodyNotes));
  const isDragging = useRef(false);

  // Store callbacks in refs to avoid effect dependency cascades
  const getTimeRef = useRef(getTime);
  getTimeRef.current = getTime;
  const selStartRef = useRef<number | null>(null);
  const selEndRef = useRef<number | null>(null);
  const [, forceRender] = useState(0); // trigger re-render only when selection finalizes
  const onScrubRef = useRef(onScrub);
  onScrubRef.current = onScrub;
  const onRegionSelectRef = useRef(onRegionSelect);
  onRegionSelectRef.current = onRegionSelect;

  useEffect(() => {
    pitchRange.current = computePitchRange(melodyNotes);
  }, [melodyNotes]);

  const render = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const t = getTimeRef.current();
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

    // 2. Semitone grid with in-key row highlights
    const rowH = DRAW_H / midiRange;
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let midi = Math.ceil(minMidi); midi <= Math.floor(maxMidi); midi++) {
      const y = midiToY(midi);
      const noteIdx = ((midi % 12) + 12) % 12;
      const isNatural = [0, 2, 4, 5, 7, 9, 11].includes(noteIdx);
      const isInKey = scalePitchClasses?.includes(noteIdx) ?? false;

      // Highlight in-key rows
      if (isInKey) {
        ctx.fillStyle = IN_KEY_ROW;
        ctx.fillRect(MARGIN_LEFT, y - rowH / 2, DRAW_W, rowH);
      }

      // Grid line
      ctx.beginPath();
      ctx.strokeStyle = isInKey ? GRID_MAJOR : GRID_MINOR;
      ctx.lineWidth = isInKey ? 0.8 : 0.3;
      ctx.moveTo(MARGIN_LEFT, y);
      ctx.lineTo(w, y);
      ctx.stroke();

      // Note label — highlight in-key notes
      const octave = Math.floor(midi / 12) - 1;
      if (isNatural || isInKey) {
        ctx.fillStyle = isInKey ? 'rgba(245, 166, 35, 0.5)' : TEXT_MUTED;
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

    // 3b. Amplitude envelope (vocal audio waveform for debugging)
    if (amplitude && amplitude.envelope.length > 0) {
      const frameDuration = amplitude.hop / amplitude.sr;
      const maxAmp = Math.max(...amplitude.envelope) || 1;
      const ampH = DRAW_H * 0.15; // use bottom 15% of canvas

      ctx.beginPath();
      ctx.strokeStyle = 'rgba(45, 212, 168, 0.3)'; // teal, transparent
      ctx.lineWidth = 1;

      let started = false;
      const startIdx = Math.max(0, Math.floor(windowStart / frameDuration));
      const endIdx = Math.min(amplitude.envelope.length, Math.ceil(windowEnd / frameDuration));

      for (let i = startIdx; i < endIdx; i++) {
        const t = i * frameDuration;
        const x = timeToX(t);
        if (x < MARGIN_LEFT || x > w) continue;
        const amp = amplitude.envelope[i] / maxAmp;
        const y = DRAW_H - amp * ampH;
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Draw a baseline
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(45, 212, 168, 0.1)';
      ctx.moveTo(MARGIN_LEFT, DRAW_H);
      ctx.lineTo(w, DRAW_H);
      ctx.stroke();
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

    // 5. Melody guide — dim rectangles (note boundaries) + pitch contour (actual pitch)
    const noteH = Math.max(4, (DRAW_H / midiRange) * 0.4);

    // 5a. Note rectangles (full opacity)
    ctx.fillStyle = AMBER_DIM;
    ctx.strokeStyle = 'rgba(245, 166, 35, 0.6)';
    ctx.lineWidth = 1;

    for (const note of melodyNotes) {
      if (note.midi_pitch < 36 || note.midi_pitch > 84) continue;
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

    // 5b. Smoothed pitch contour line
    if (pitchContour && pitchContour.contour.length > 0) {
      const fd = pitchContour.frame_duration;
      const SMOOTH = 5; // moving average window (frames)
      const half = Math.floor(SMOOTH / 2);
      const startIdx = Math.max(0, Math.floor(windowStart / fd) - half);
      const endIdx = Math.min(pitchContour.contour.length, Math.ceil(windowEnd / fd) + half);

      ctx.beginPath();
      ctx.strokeStyle = 'rgba(245, 166, 35, 0.3)';
      ctx.lineWidth = 1;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      let drawing = false;
      for (let i = startIdx + half; i < endIdx - half; i++) {
        // Moving average over SMOOTH frames (skip if any frame in window is null)
        let sum = 0;
        let count = 0;
        let hasNull = false;
        for (let j = i - half; j <= i + half; j++) {
          const v = pitchContour.contour[j];
          if (v === null) { hasNull = true; break; }
          sum += v;
          count++;
        }

        if (hasNull || count === 0) {
          drawing = false;
          continue;
        }

        const midi = sum / count;
        const t = i * fd;
        const x = timeToX(t);
        if (x < MARGIN_LEFT || x > w) { drawing = false; continue; }
        const y = midiToY(midi);
        if (!drawing) {
          ctx.moveTo(x, y);
          drawing = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
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

  // Store isPlaying and render in refs so the animation loop never restarts
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const renderRef = useRef(render);
  renderRef.current = render;

  // Stable canvas setup — never torn down
  const loopRef = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;

    const drawFrame = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const rect = canvas.getBoundingClientRect();
      ctx.save();
      ctx.scale(dpr, dpr);
      renderRef.current(ctx, rect.width, rect.height);
      ctx.restore();
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      drawFrame();
    };

    resize();
    const obs = new ResizeObserver(resize);
    obs.observe(canvas);

    let running = true;
    const loop = () => {
      if (!running) return;
      drawFrame();
      if (isPlayingRef.current || isDragging.current) {
        animRef.current = requestAnimationFrame(loop);
      }
    };
    loopRef.current = loop;

    // Draw once
    requestAnimationFrame(loop);

    return () => {
      running = false;
      cancelAnimationFrame(animRef.current);
      obs.disconnect();
    };
  }, []);

  // Kick the loop when isPlaying becomes true (no second loop — reuses the stable one)
  useEffect(() => {
    if (isPlaying) {
      animRef.current = requestAnimationFrame(loopRef.current);
      return () => cancelAnimationFrame(animRef.current);
    } else {
      // Redraw once when paused (freeze frame)
      loopRef.current();
    }
  }, [isPlaying]);

  // Redraw when scrubbing (paused — triggered by parent calling onScrub which changes the audio time)
  const redraw = useCallback(() => loopRef.current(), []);

  // Expose redraw for external triggers
  useEffect(() => {
    if (!isPlaying) loopRef.current();
  }, [isPlaying]);

  // Mouse handlers — read from refs to avoid dependency cascades
  const getTimeFromX = useCallback((clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const DRAW_W = rect.width - MARGIN_LEFT;
    const VIS = visSecsRef.current;
    const windowStart = getTimeRef.current() - VIS * NOW_FRACTION;
    return windowStart + ((x - MARGIN_LEFT) / DRAW_W) * VIS;
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const t = getTimeFromX(e.clientX);
    const clampedT = Math.max(0, Math.min(duration, t));

    if (mode === 'review' && e.shiftKey) {
      isDragging.current = true;
      selStartRef.current = clampedT;
      selEndRef.current = clampedT;
    } else {
      // Click to seek in any mode — scrub then redraw
      onScrubRef.current?.(clampedT);
      requestAnimationFrame(() => loopRef.current());
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
      style={{ height: '420px', cursor: mode === 'recording' ? 'default' : 'crosshair' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
    />
  );
}
