import { useRef, useState, useCallback } from 'react';

interface Props {
  interval: string;
  harmonyUrl: string;
  mixedUrl: string;
  isPlaying: boolean;
  isSelected: boolean;
  onPlay: (interval: string) => void;
  onStop: () => void;
  onSelect: (interval: string, selected: boolean) => void;
}

const INTERVAL_LABELS: Record<string, string> = {
  '3rd-above': '3rd Above',
  '3rd-below': '3rd Below',
  '5th': '5th',
  '6th': '6th',
  'octave': 'Octave',
  'unison': 'Unison',
  'drone-root': 'Drone (Root)',
  'drone-5th': 'Drone (5th)',
};

export function IntervalCard({
  interval, harmonyUrl, mixedUrl,
  isPlaying, isSelected, onPlay, onStop, onSelect,
}: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [mode, setMode] = useState<'mixed' | 'harmony'>('mixed');

  const handlePlay = useCallback(() => {
    if (isPlaying) {
      audioRef.current?.pause();
      onStop();
    } else {
      onPlay(interval);
      const url = mode === 'mixed' ? mixedUrl : harmonyUrl;
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.play();
      }
    }
  }, [isPlaying, interval, mode, mixedUrl, harmonyUrl, onPlay, onStop]);

  const handleModeSwitch = useCallback((newMode: 'mixed' | 'harmony') => {
    setMode(newMode);
    if (isPlaying && audioRef.current) {
      const currentTime = audioRef.current.currentTime;
      audioRef.current.src = newMode === 'mixed' ? mixedUrl : harmonyUrl;
      audioRef.current.currentTime = currentTime;
      audioRef.current.play();
    }
  }, [isPlaying, mixedUrl, harmonyUrl]);

  return (
    <div className={`
      p-4 rounded-lg border transition-all
      ${isPlaying ? 'border-purple-500 bg-purple-500/10' : 'border-gray-700 bg-gray-800/50'}
      ${isSelected ? 'ring-2 ring-purple-400' : ''}
    `}>
      <audio
        ref={audioRef}
        onEnded={onStop}
        preload="none"
      />

      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium text-sm">
          {INTERVAL_LABELS[interval] || interval}
        </h3>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e) => onSelect(interval, e.target.checked)}
            className="rounded"
          />
          <span className="text-xs text-gray-400">Select</span>
        </label>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handlePlay}
          className={`
            px-3 py-1.5 rounded text-sm font-medium transition-colors
            ${isPlaying
              ? 'bg-purple-600 hover:bg-purple-500'
              : 'bg-gray-700 hover:bg-gray-600'}
          `}
        >
          {isPlaying ? 'Stop' : 'Play'}
        </button>

        <div className="flex bg-gray-700 rounded text-xs overflow-hidden">
          <button
            onClick={() => handleModeSwitch('mixed')}
            className={`px-2 py-1 transition-colors ${mode === 'mixed' ? 'bg-purple-600' : 'hover:bg-gray-600'}`}
          >
            Mixed
          </button>
          <button
            onClick={() => handleModeSwitch('harmony')}
            className={`px-2 py-1 transition-colors ${mode === 'harmony' ? 'bg-purple-600' : 'hover:bg-gray-600'}`}
          >
            Harmony
          </button>
        </div>
      </div>
    </div>
  );
}
