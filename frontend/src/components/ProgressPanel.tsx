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
    <div className="p-4 bg-gray-800/50 rounded-lg space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-300">{progress.message}</span>
        <span className="text-gray-500">
          Step {progress.step_num}/{progress.total_steps}
        </span>
      </div>
      <div className="w-full bg-gray-700 rounded-full h-2">
        <div
          className="bg-purple-500 h-2 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      {progress.status === 'failed' && (
        <p className="text-red-400 text-sm">Error: {progress.error}</p>
      )}
    </div>
  );
}
