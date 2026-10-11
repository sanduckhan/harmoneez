import { motion } from 'motion/react';
import type { VocalRange } from '../types';
import { midiToNoteName } from '../utils';

interface Props {
  range: VocalRange | null | undefined;  // undefined = still analyzing, null = no singing found
  failed: boolean;
  transpose: number;  // semitones, applied to the original-key range
}

// Meter spans C2–C6, covering bass through soprano
const METER_MIN = 36;
const METER_MAX = 84;
const OCTAVE_MARKS = [36, 48, 60, 72, 84];

const toPct = (midi: number) =>
  Math.min(100, Math.max(0, ((midi - METER_MIN) / (METER_MAX - METER_MIN)) * 100));

const spring = { type: 'spring', stiffness: 300, damping: 30 } as const;

export function VocalRangeMeter({ range, failed, transpose }: Props) {
  let body;
  if (failed || range === null) {
    body = (
      <p className="text-sm font-mono text-[var(--text-muted)] mt-1">
        {failed ? 'Unavailable' : 'No vocals detected'}
      </p>
    );
  } else if (range === undefined) {
    body = (
      <div className="flex items-center justify-center gap-2 mt-2">
        <motion.div
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ repeat: Infinity, duration: 1.5 }}
          className="w-2 h-2 rounded-full bg-[var(--amber)] shadow-[0_0_6px_var(--amber)]"
        />
        <span className="text-xs font-mono text-[var(--text-secondary)]">Isolating vocals...</span>
      </div>
    );
  } else {
    const low = range.low + transpose;
    const high = range.high + transpose;
    const center = range.center + transpose;

    body = (
      <>
        <p className="text-lg font-mono text-[var(--text-primary)] tabular-nums mt-1">
          {midiToNoteName(low)} – {midiToNoteName(high)}
        </p>
        <p className="text-[10px] font-mono text-[var(--text-muted)]">
          sits around {midiToNoteName(center)}
          {transpose !== 0 && ` · originally ${midiToNoteName(range.low)} – ${midiToNoteName(range.high)}`}
        </p>

        <div className="relative w-full max-w-sm mx-auto h-9 mt-3">
          <div className="absolute top-1.5 inset-x-0 h-2 rounded-full bg-[var(--bg-surface)] border border-[var(--border)]" />

          {transpose !== 0 && (
            <div
              className="absolute top-1.5 h-2 rounded-full bg-[var(--amber-glow)]"
              style={{ left: `${toPct(range.low)}%`, width: `${toPct(range.high) - toPct(range.low)}%` }}
            />
          )}

          <motion.div
            className="absolute top-1.5 h-2 rounded-full bg-[var(--amber)] shadow-[0_0_8px_var(--amber-glow)]"
            initial={false}
            animate={{ left: `${toPct(low)}%`, width: `${toPct(high) - toPct(low)}%` }}
            transition={spring}
          />
          <motion.div
            className="absolute top-0.5 w-0.5 h-4 -ml-px rounded-full bg-[var(--amber-bright)]"
            initial={false}
            animate={{ left: `${toPct(center)}%` }}
            transition={spring}
          />

          {OCTAVE_MARKS.map(midi => (
            <span
              key={midi}
              className="absolute top-5 -translate-x-1/2 text-[9px] font-mono text-[var(--text-muted)]"
              style={{ left: `${toPct(midi)}%` }}
            >
              {midiToNoteName(midi)}
            </span>
          ))}
        </div>
      </>
    );
  }

  return (
    <div>
      <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-widest">Vocal Range</span>
      {body}
    </div>
  );
}
