import type { KeyDetectionResult } from '../types';
import { ALL_KEYS } from '../types';
import { formatTime } from '../utils';

interface Props {
  keyInfo: KeyDetectionResult | null;
  selectedKey: string;
  onKeyChange: (key: string) => void;
  pitchCorrect: boolean;
  onPitchCorrectChange: (v: boolean) => void;
  harmonyVolume: number;
  onVolumeChange: (v: number) => void;
  regionStart: number | null;
  regionEnd: number | null;
}

export function SettingsPanel({
  keyInfo, selectedKey, onKeyChange,
  pitchCorrect, onPitchCorrectChange,
  harmonyVolume, onVolumeChange,
  regionStart, regionEnd,
}: Props) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-[var(--border)] rounded-lg overflow-hidden border border-[var(--border)]">
      {/* Key */}
      <div className="bg-[var(--bg-panel)] p-4">
        <label className="block text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-widest mb-2">Key</label>
        <select
          value={selectedKey}
          onChange={(e) => onKeyChange(e.target.value)}
          className="w-full bg-[var(--bg-surface)] border border-[var(--border-highlight)] rounded px-2 py-1.5 text-sm font-mono text-[var(--text-primary)] focus:border-[var(--amber)] focus:outline-none transition-colors"
        >
          {ALL_KEYS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
        {keyInfo && (
          <div className="flex items-center gap-1.5 mt-2">
            <div className={`w-1.5 h-1.5 rounded-full ${keyInfo.confidence > 0.7 ? 'bg-[var(--teal)]' : 'bg-[var(--amber)]'}`} />
            <span className="text-[10px] font-mono text-[var(--text-muted)]">
              {keyInfo.key} ({(keyInfo.confidence * 100).toFixed(0)}%)
            </span>
          </div>
        )}
      </div>

      {/* Pitch correction */}
      <div className="bg-[var(--bg-panel)] p-4">
        <label className="block text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-widest mb-2">Pitch Correct</label>
        <button
          onClick={() => onPitchCorrectChange(!pitchCorrect)}
          className={`
            relative w-12 h-6 rounded-full transition-all duration-200
            ${pitchCorrect
              ? 'bg-[var(--amber)] shadow-[0_0_10px_var(--amber-glow)]'
              : 'bg-[var(--bg-surface)] border border-[var(--border-highlight)]'}
          `}
        >
          <div className={`
            absolute top-0.5 w-5 h-5 rounded-full transition-all duration-200
            ${pitchCorrect
              ? 'left-[26px] bg-[var(--bg-deep)]'
              : 'left-0.5 bg-[var(--text-muted)]'}
          `} />
        </button>
        <span className="block text-[10px] font-mono text-[var(--text-muted)] mt-1.5">
          {pitchCorrect ? '80% strength' : 'disabled'}
        </span>
      </div>

      {/* Volume */}
      <div className="bg-[var(--bg-panel)] p-4">
        <label className="block text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-widest mb-2">
          Harmony Vol
        </label>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0} max={100} value={harmonyVolume * 100}
            onChange={(e) => onVolumeChange(Number(e.target.value) / 100)}
            className="flex-1"
          />
          <span className="font-mono text-sm text-[var(--amber)] w-10 text-right tabular-nums">
            {Math.round(harmonyVolume * 100)}%
          </span>
        </div>
      </div>

      {/* Section */}
      <div className="bg-[var(--bg-panel)] p-4">
        <label className="block text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-widest mb-2">Section</label>
        <p className="font-mono text-sm text-[var(--text-primary)]">
          {regionStart !== null && regionEnd !== null
            ? `${formatTime(regionStart)} — ${formatTime(regionEnd)}`
            : '— full —'}
        </p>
      </div>
    </div>
  );
}
