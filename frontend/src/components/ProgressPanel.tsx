import { motion } from 'motion/react';
import type { ProgressMessage } from '../types';

interface Props {
  progress: ProgressMessage | null;
}

export function ProgressPanel({ progress }: Props) {
  if (!progress) return null;

  const pct = progress.total_steps > 0
    ? Math.round((progress.step_num / progress.total_steps) * 100)
    : 0;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      className="rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] overflow-hidden"
    >
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Animated pulse dot */}
            <motion.div
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ repeat: Infinity, duration: 1.5 }}
              className="w-2 h-2 rounded-full bg-[var(--amber)] shadow-[0_0_6px_var(--amber)]"
            />
            <span className="text-sm font-mono text-[var(--text-primary)]">{progress.message}</span>
          </div>
          <span className="text-xs font-mono text-[var(--text-muted)] tabular-nums">
            {progress.step_num}/{progress.total_steps}
          </span>
        </div>

        {/* Segmented progress bar */}
        <div className="flex gap-1">
          {Array.from({ length: progress.total_steps || 1 }, (_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${
                i < progress.step_num
                  ? 'bg-[var(--amber)] shadow-[0_0_4px_var(--amber-glow)]'
                  : i === progress.step_num
                    ? 'bg-[var(--amber-dim)]'
                    : 'bg-[var(--border)]'
              }`}
            />
          ))}
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
