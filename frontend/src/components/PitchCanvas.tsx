import { useEffect, useRef, useCallback } from 'react';
import type { MelodyNote, PitchSample } from '../types';
import { findActiveNote, NOTE_NAMES } from '../utils';

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
  transposeOffset?: number;  // semitones to shift melody/contour display
  amplitude?: AmplitudeEnvelope | null;
  pitchContour?: PitchContour | null;
  selection?: { start: number; end: number } | null;
  onScrub?: (time: number) => void;
  onRegionSelect?: (start: number, end: number) => void;
  onClearSelection?: () => void;
  seekVersion?: number;  // increment to force canvas redraw after programmatic seek
  className?: string;
}

const MARGIN_LEFT = 44;
const MARGIN_BOTTOM = 24;
const DEFAULT_VISIBLE_SECONDS = 12;
const NOW_FRACTION = 0.3;

const BG = '#06060a';
const GRID_MAJOR = 'rgba(70, 70, 100, 0.5)';
const GRID_MINOR = 'rgba(50, 50, 75, 0.3)';
const AMBER = '#f5a623';
const AMBER_DIM = 'rgba(245, 166, 35, 0.25)';
const IN_KEY_ROW = 'rgba(245, 166, 35, 0.07)';  // subtle highlight for in-key rows
const AMBER_GLOW = 'rgba(245, 166, 35, 0.08)';
const TEAL = '#2dd4a8';
const RED = '#ef4444';
const TEXT_MUTED = '#7a7690';
const SELECTION = 'rgba(245, 166, 35, 0.12)';

function computePitchRange(notes: MelodyNote[], offset: number = 0) {
  if (notes.length === 0) return { minMidi: 57 + offset, maxMidi: 69 + offset };
  const vocalNotes = notes.filter(n => n.midi_pitch >= 36 && n.midi_pitch <= 84);
  if (vocalNotes.length === 0) return { minMidi: 57 + offset, maxMidi: 69 + offset };
  let min = Infinity, max = -Infinity;
  for (const n of vocalNotes) {
    const p = n.midi_pitch + offset;
    if (p < min) min = p;
    if (p > max) max = p;
  }
  return { minMidi: min - 2, maxMidi: max + 2 };
}

function deviationColor(notes: MelodyNote[], time: number, userMidi: number, offset: number = 0): string {
  const note = findActiveNote(notes, time);
  if (!note) return 'rgba(139, 135, 160, 0.4)';
  const cents = Math.abs(userMidi - (note.midi_pitch + offset)) * 100;
  if (cents < 20) return TEAL;
  if (cents < 40) return AMBER;
  return RED;
}

export function PitchCanvas({
  melodyNotes, pitchSamplesRef, getTime, duration,
  mode, isPlaying, scalePitchClasses, transposeOffset = 0, amplitude, pitchContour, selection, onScrub, onRegionSelect, onClearSelection, seekVersion, className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const visSecsRef = useRef(DEFAULT_VISIBLE_SECONDS);
  // Absolute time of the left edge of the view (null = follow mode, auto-center on playhead)
  const viewStartRef = useRef<number | null>(null);
  const pitchRange = useRef(computePitchRange(melodyNotes));
  const isDragging = useRef(false);
  const dragOriginX = useRef(0); // mouse X at drag start, for distance threshold

  // Store values in refs to avoid effect dependency cascades
  const getTimeRef = useRef(getTime);
  getTimeRef.current = getTime;
  const transposeRef = useRef(transposeOffset);
  transposeRef.current = transposeOffset;
  const scaleRef = useRef(scalePitchClasses);
  scaleRef.current = scalePitchClasses;
  // Selection: controlled from parent, with local drag-in-progress overlay
  const selStartRef = useRef<number | null>(null);
  const selEndRef = useRef<number | null>(null);
  // Sync controlled selection prop into refs for rendering
  if (!isDragging.current) {
    selStartRef.current = selection?.start ?? null;
    selEndRef.current = selection?.end ?? null;
  }
  const onScrubRef = useRef(onScrub);
  onScrubRef.current = onScrub;
  const onRegionSelectRef = useRef(onRegionSelect);
  onRegionSelectRef.current = onRegionSelect;
  const onClearSelectionRef = useRef(onClearSelection);
  onClearSelectionRef.current = onClearSelection;

  const amplitudeMaxRef = useRef(1);
  useEffect(() => {
    if (amplitude && amplitude.envelope.length > 0) {
      let max = 0;
      for (const v of amplitude.envelope) { if (v > max) max = v; }
      amplitudeMaxRef.current = max || 1;
    }
  }, [amplitude]);

  useEffect(() => {
    pitchRange.current = computePitchRange(melodyNotes, transposeOffset);
    // Redraw when transpose or scale changes
    loopRef.current();
  }, [melodyNotes, transposeOffset, scalePitchClasses]);

  const render = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const t = getTimeRef.current();
    const txp = transposeRef.current;
    const DRAW_W = w - MARGIN_LEFT;
    const DRAW_H = h - MARGIN_BOTTOM;
    const VIS = visSecsRef.current;

    // Follow mode (viewStartRef null): view is anchored so playhead sits at NOW_FRACTION.
    // Free mode (viewStartRef set): view is fixed, playhead moves freely.
    // During playback in free mode, once the playhead reaches the anchor point,
    // snap back to follow mode.
    const followStart = t - VIS * NOW_FRACTION;
    let windowStart: number;
    if (viewStartRef.current === null) {
      windowStart = followStart;
    } else {
      // Check if playhead has reached or passed the anchor point
      const anchorTime = viewStartRef.current + VIS * NOW_FRACTION;
      if (isPlayingRef.current && t >= anchorTime) {
        viewStartRef.current = null;
        windowStart = followStart;
      } else {
        windowStart = viewStartRef.current;
      }
    }
    const windowEnd = windowStart + VIS;
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
      const isInKey = scaleRef.current?.includes(noteIdx) ?? false;

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
        ctx.fillStyle = isInKey ? 'rgba(245, 166, 35, 0.7)' : TEXT_MUTED;
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
      const maxAmp = amplitudeMaxRef.current;
      const ampH = DRAW_H * 0.15; // use bottom 15% of canvas

      ctx.beginPath();
      ctx.strokeStyle = 'rgba(45, 212, 168, 0.5)';
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
      const y = midiToY(note.midi_pitch + txp);
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
        const ct = i * fd;
        const x = timeToX(ct);
        if (x < MARGIN_LEFT || x > w) { drawing = false; continue; }
        const y = midiToY(midi + txp);
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
        ctx.strokeStyle = deviationColor(melodyNotes, curr.time, curr.midi, txp);
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.moveTo(timeToX(prev.time), midiToY(prev.midi));
        ctx.lineTo(timeToX(curr.time), midiToY(curr.midi));
        ctx.stroke();
      }
    }

    // 7. Now-marker — at anchor when in follow mode, at true position otherwise
    const nowX = viewStartRef.current === null
      ? MARGIN_LEFT + DRAW_W * NOW_FRACTION
      : timeToX(t);
    if (nowX >= MARGIN_LEFT && nowX <= w) {
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
    }
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

  // Redraw when paused (programmatic seek via transport bar, skip-to-start, etc.)
  useEffect(() => {
    if (!isPlaying) {
      // Programmatic seek (e.g. skip-to-start) → snap back to follow mode
      viewStartRef.current = null;
      loopRef.current();
    }
  }, [isPlaying, seekVersion]);

  // Mouse handlers — read from refs to avoid dependency cascades
  const getTimeFromX = useCallback((clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const DRAW_W = rect.width - MARGIN_LEFT;
    const VIS = visSecsRef.current;
    const windowStart = viewStartRef.current ?? (getTimeRef.current() - VIS * NOW_FRACTION);
    return windowStart + ((x - MARGIN_LEFT) / DRAW_W) * VIS;
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (mode === 'recording') return; // no interaction during recording

    const t = getTimeFromX(e.clientX);
    const clampedT = Math.max(0, Math.min(duration, t));

    if (mode === 'review') {
      // In review: start potential drag (could become selection or seek on mouseUp)
      isDragging.current = true;
      dragOriginX.current = e.clientX;
      selStartRef.current = clampedT;
      selEndRef.current = clampedT;
    } else {
      // Guide mode: click to seek — freeze view, move playhead only
      const VIS = visSecsRef.current;
      if (viewStartRef.current === null) {
        viewStartRef.current = getTimeRef.current() - VIS * NOW_FRACTION;
      }
      onScrubRef.current?.(clampedT);
      requestAnimationFrame(() => loopRef.current());
    }
  }, [mode, getTimeFromX, duration]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current || mode !== 'review') return;
    // Only start visual selection after dragging > 5px (otherwise it's a click)
    if (Math.abs(e.clientX - dragOriginX.current) < 5) return;

    const t = getTimeFromX(e.clientX);
    selEndRef.current = t;
    // Redraw to show selection overlay
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
  }, [mode, getTimeFromX, render]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    isDragging.current = false;

    const draggedFar = Math.abs(e.clientX - dragOriginX.current) >= 5;
    const ss = selStartRef.current;
    const se = selEndRef.current;

    if (draggedFar && ss !== null && se !== null) {
      // Drag → create selection (if > 0.5s)
      const s = Math.min(ss, se);
      const end = Math.max(ss, se);
      if (end - s > 0.5) {
        onRegionSelectRef.current?.(s, end);
      } else {
        // Too short drag — clear and seek instead
        const VIS = visSecsRef.current;
        if (viewStartRef.current === null) {
          viewStartRef.current = getTimeRef.current() - VIS * NOW_FRACTION;
        }
        onClearSelectionRef.current?.();
        onScrubRef.current?.(Math.max(0, Math.min(duration, ss)));
      }
    } else {
      // Short click → seek — freeze view, move playhead only
      const VIS = visSecsRef.current;
      if (viewStartRef.current === null) {
        viewStartRef.current = getTimeRef.current() - VIS * NOW_FRACTION;
      }
      const t = getTimeFromX(e.clientX);
      const clampedT = Math.max(0, Math.min(duration, t));
      onClearSelectionRef.current?.();
      onScrubRef.current?.(clampedT);
      requestAnimationFrame(() => loopRef.current());
    }
  }, [getTimeFromX, duration]);

  // Native wheel listener with { passive: false } to actually prevent browser back/forward
  const durationRef = useRef(duration);
  durationRef.current = duration;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      // Shift + scroll = zoom
      if (e.shiftKey && e.deltaY !== 0) {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 1.15 : 0.87;
        visSecsRef.current = Math.max(4, Math.min(durationRef.current, visSecsRef.current * factor));
        loopRef.current();
        return;
      }
      // Horizontal scroll (trackpad swipe) — always prevent browser back/forward
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        if (!isPlayingRef.current) {
          const VIS = visSecsRef.current;
          // Enter free mode if not already
          if (viewStartRef.current === null) {
            viewStartRef.current = getTimeRef.current() - VIS * NOW_FRACTION;
          }
          viewStartRef.current += (e.deltaX / 300) * VIS;
          loopRef.current();
        }
      }
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });

    // Disable browser back/forward swipe while hovering canvas
    const disableOverscroll = () => { document.documentElement.style.overscrollBehaviorX = 'none'; };
    const restoreOverscroll = () => { document.documentElement.style.overscrollBehaviorX = ''; };
    canvas.addEventListener('mouseenter', disableOverscroll);
    canvas.addEventListener('mouseleave', restoreOverscroll);

    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('mouseenter', disableOverscroll);
      canvas.removeEventListener('mouseleave', restoreOverscroll);
      restoreOverscroll();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`w-full rounded-lg ${className || ''}`}
      style={{ height: '420px', cursor: mode === 'recording' ? 'default' : mode === 'review' ? 'crosshair' : 'pointer' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => { if (isDragging.current) { isDragging.current = false; } }}
    />
  );
}
