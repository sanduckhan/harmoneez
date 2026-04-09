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
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-gray-800/50 rounded-lg">
      {/* Key */}
      <div>
        <label className="block text-xs text-gray-400 mb-1">Key</label>
        <select
          value={selectedKey}
          onChange={(e) => onKeyChange(e.target.value)}
          className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm"
        >
          {ALL_KEYS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
        {keyInfo && (
          <p className="text-xs text-gray-500 mt-1">
            Detected: {keyInfo.key} ({(keyInfo.confidence * 100).toFixed(0)}%)
          </p>
        )}
      </div>

      {/* Pitch correction */}
      <div>
        <label className="block text-xs text-gray-400 mb-1">Pitch Correction</label>
        <label className="flex items-center gap-2 mt-1.5">
          <input
            type="checkbox"
            checked={pitchCorrect}
            onChange={(e) => onPitchCorrectChange(e.target.checked)}
            className="rounded"
          />
          <span className="text-sm">{pitchCorrect ? 'On (80%)' : 'Off'}</span>
        </label>
      </div>

      {/* Volume */}
      <div>
        <label className="block text-xs text-gray-400 mb-1">
          Harmony Volume: {Math.round(harmonyVolume * 100)}%
        </label>
        <input
          type="range"
          min={0} max={100} value={harmonyVolume * 100}
          onChange={(e) => onVolumeChange(Number(e.target.value) / 100)}
          className="w-full mt-1"
        />
      </div>

      {/* Section */}
      <div>
        <label className="block text-xs text-gray-400 mb-1">Section</label>
        <p className="text-sm mt-1.5">
          {regionStart !== null && regionEnd !== null
            ? `${formatTime(regionStart)} - ${formatTime(regionEnd)}`
            : 'Full song'}
        </p>
      </div>
    </div>
  );
}
