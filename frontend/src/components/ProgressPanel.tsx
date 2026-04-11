import { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import type { ProgressMessage } from '../types';

interface Props {
  progress: ProgressMessage | null;
}

interface StepInfo {
  name: string;
  message: string;
  done: boolean;
}

// Weight and estimated duration (seconds) per step
const STEP_INFO: Record<string, { weight: number; estimateS: number }> = {
  separating: { weight: 55, estimateS: 80 },
  transposing: { weight: 35, estimateS: 40 },
  extracting_melody: { weight: 10, estimateS: 10 },
};

export function ProgressPanel({ progress }: Props) {
  const [steps, setSteps] = useState<StepInfo[]>([]);

  useEffect(() => {
    if (!progress || progress.step === 'done' || !progress.message) return;

    setSteps(prev => {
      const existing = prev.find(s => s.message === progress.message);
      if (existing) return prev;

      const next = [
        ...prev.map(s => ({ ...s, done: true })),
        { name: progress.step, message: progress.message, done: false },
      ];
      return next;
    });
  }, [progress]);

  // Elapsed timer for the active step
  const stepStartRef = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    stepStartRef.current = Date.now();
    setElapsed(0);
  }, [steps.length]);

  useEffect(() => {
    if (!progress || progress.step === 'done') return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - stepStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [progress?.step]);

  if (!progress) return null;

  // Calculate weighted progress with intra-step animation
  const totalWeight = steps.reduce((sum, s) => sum + (STEP_INFO[s.name]?.weight || 10), 0) || 100;
  let weightedPct = 0;
  for (const s of steps) {
    const info = STEP_INFO[s.name] || { weight: 10, estimateS: 10 };
    if (s.done) {
      weightedPct += info.weight;
    } else {
      // Active step: fill proportionally based on elapsed vs estimate
      const intraProgress = Math.min(0.95, elapsed / info.estimateS); // cap at 95% to avoid looking stuck
      weightedPct += info.weight * intraProgress;
    }
  }
  const pct = Math.min(99, Math.round((weightedPct / totalWeight) * 100));

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      className="rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] overflow-hidden"
    >
      <div className="p-4 space-y-3">
        {/* Step checklist */}
        <div className="space-y-1.5">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              {s.done ? (
                <span className="w-4 h-4 flex items-center justify-center text-[10px] text-[var(--teal)]">✓</span>
              ) : (
                <motion.div
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ repeat: Infinity, duration: 1.5 }}
                  className="w-2 h-2 ml-1 rounded-full bg-[var(--amber)] shadow-[0_0_6px_var(--amber)]"
                />
              )}
              <span className={`text-xs font-mono flex-1 ${s.done ? 'text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>
                {s.message}
              </span>
              {!s.done && elapsed > 0 && (
                <span className="text-[10px] font-mono text-[var(--text-muted)] tabular-nums">
                  {elapsed}s
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Weighted continuous progress bar */}
        <div className="w-full h-1.5 bg-[var(--border)] rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-[var(--amber)] rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        </div>

        {progress.status === 'failed' && (
          <div className="flex items-center gap-2 px-3 py-2 rounded bg-[var(--red-glow)] border border-[var(--red)]/30">
            <span className="w-2 h-2 rounded-full bg-[var(--red)]" />
            <span className="text-sm text-[var(--red)]">{progress.error}</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
