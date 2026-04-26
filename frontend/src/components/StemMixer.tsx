import { useState, useRef, useCallback, useEffect } from 'react';
import { formatTime } from '../utils';

interface Stem {
  id: string;
  label: string;
  url: string;
}

interface Props {
  stems: Stem[];
}

interface StemState {
  muted: boolean;
  solo: boolean;
  volume: number;
}

export function StemMixer({ stems }: Props) {
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [stemStates, setStemStates] = useState<Record<string, StemState>>({});
  const scrubRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);

  // Initialize stem states. Default: lead + 3rd-above audible; everything
  // else muted so users opt into harmonies one at a time instead of being
  // hit with the full stack at once.
  useEffect(() => {
    const initial: Record<string, StemState> = {};
    const audibleByDefault = new Set(['vocal', '3rd-above']);
    for (const s of stems) {
      initial[s.id] = {
        muted: !audibleByDefault.has(s.id),
        solo: false,
        volume: 0.8,
      };
    }
    if (stems.length > 0) initial[stems[0].id].volume = 1.0;
    setStemStates(initial);
  }, [stems]);

  // Update effective gains whenever solo/mute/volume changes
  useEffect(() => {
    const hasSolo = Object.values(stemStates).some(s => s.solo);
    for (const [id, el] of audioRefs.current) {
      const state = stemStates[id];
      if (!state) continue;
      if (state.muted) {
        el.volume = 0;
      } else if (hasSolo && !state.solo) {
        el.volume = 0;
      } else {
        el.volume = state.volume;
      }
    }
  }, [stemStates]);

  // Animation loop for time display
  useEffect(() => {
    if (!playing) return;
    const tick = () => {
      const master = audioRefs.current.values().next().value;
      if (master) setCurrentTime(master.currentTime);
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [playing]);

  const durationRef = useRef(0);
  durationRef.current = duration;

  const endRegistered = useRef(false);

  const registerAudio = useCallback((id: string, el: HTMLAudioElement | null) => {
    if (el) {
      audioRefs.current.set(id, el);
      el.onloadedmetadata = () => {
        if (el.duration && el.duration > durationRef.current) {
          setDuration(el.duration);
        }
      };
      // Only the first stem controls playback end
      if (!endRegistered.current) {
        el.onended = () => setPlaying(false);
        endRegistered.current = true;
      }
    } else {
      audioRefs.current.delete(id);
    }
  }, []);

  const playAll = useCallback(() => {
    for (const el of audioRefs.current.values()) {
      el.play().catch(() => {});
    }
    setPlaying(true);
  }, []);

  const pauseAll = useCallback(() => {
    for (const el of audioRefs.current.values()) {
      el.pause();
    }
    setPlaying(false);
  }, []);

  const seekAll = useCallback((time: number) => {
    for (const el of audioRefs.current.values()) {
      el.currentTime = time;
    }
    setCurrentTime(time);
  }, []);

  const handlePlayPause = useCallback(() => {
    if (playing) pauseAll();
    else playAll();
  }, [playing, playAll, pauseAll]);

  const playingRef = useRef(false);
  playingRef.current = playing;

  // Spacebar play/pause
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        if (playingRef.current) pauseAll();
        else playAll();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playAll, pauseAll]);

  const handleScrub = useCallback((e: React.MouseEvent) => {
    if (!scrubRef.current || duration === 0) return;
    const rect = scrubRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekAll(pct * duration);
  }, [duration, seekAll]);

  const toggleMute = useCallback((id: string) => {
    setStemStates(prev => ({
      ...prev,
      [id]: { ...prev[id], muted: !prev[id].muted },
    }));
  }, []);

  const toggleSolo = useCallback((id: string) => {
    setStemStates(prev => ({
      ...prev,
      [id]: { ...prev[id], solo: !prev[id].solo },
    }));
  }, []);

  const setVolume = useCallback((id: string, vol: number) => {
    setStemStates(prev => ({
      ...prev,
      [id]: { ...prev[id], volume: vol },
    }));
  }, []);

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const hasSolo = Object.values(stemStates).some(s => s.solo);

  return (
    <div className="space-y-3">
      {/* Transport */}
      <div className="flex items-center gap-3">
        <button
          onClick={handlePlayPause}
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-[var(--bg-surface)] border border-[var(--border-highlight)] hover:border-[var(--amber)]/50 text-[var(--text-primary)] transition-all"
        >
          {playing ? (
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
              <rect x="2" y="1" width="3.5" height="12" rx="1" fill="currentColor" />
              <rect x="8.5" y="1" width="3.5" height="12" rx="1" fill="currentColor" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
              <path d="M3 1L12 7L3 13V1Z" fill="currentColor" />
            </svg>
          )}
        </button>

        {/* Scrub bar */}
        <div
          ref={scrubRef}
          onClick={handleScrub}
          className="flex-1 h-2 bg-[var(--border)] rounded cursor-pointer relative group"
        >
          <div
            className="h-full bg-[var(--amber)] rounded-l "
            style={{ width: `${pct}%` }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-[var(--amber)] opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ left: `calc(${pct}% - 6px)` }}
          />
        </div>

        <span className="font-mono text-xs tabular-nums text-[var(--text-muted)] min-w-[80px] text-right">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>

      {/* Stem rows */}
      <div className="space-y-1">
        {stems.map((stem, i) => {
          const state = stemStates[stem.id];
          if (!state) return null;
          const isAudible = !state.muted && (!hasSolo || state.solo);
          const isVocal = i === 0;

          return (
            <div
              key={stem.id}
              className={`flex items-center gap-2 px-3 py-1.5 rounded transition-colors ${
                isAudible ? 'bg-[var(--bg-surface)]' : 'bg-[var(--bg-panel)] opacity-50'
              }`}
            >
              <audio
                ref={(el) => registerAudio(stem.id, el)}
                src={stem.url}
                preload="metadata"
              />

              {/* Label */}
              <span className={`text-xs font-mono w-24 shrink-0 truncate ${
                isVocal ? 'text-[var(--teal)]' : 'text-[var(--text-secondary)]'
              }`}>
                {stem.label}
              </span>

              {/* Mini progress bar */}
              <div className="flex-1 h-1.5 bg-[var(--border)] rounded overflow-hidden">
                <div
                  className={`h-full rounded  ${
                    isVocal ? 'bg-[var(--teal)]' : 'bg-[var(--amber)]'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>

              {/* Solo */}
              <button
                onClick={() => toggleSolo(stem.id)}
                className={`w-6 h-6 flex items-center justify-center rounded text-[10px] font-mono font-bold transition-all ${
                  state.solo
                    ? 'bg-[var(--amber)] text-[var(--bg-deep)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }`}
                title="Solo"
              >
                S
              </button>

              {/* Mute */}
              <button
                onClick={() => toggleMute(stem.id)}
                className={`w-6 h-6 flex items-center justify-center rounded text-[10px] font-mono font-bold transition-all ${
                  state.muted
                    ? 'bg-[var(--red)] text-white'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }`}
                title="Mute"
              >
                M
              </button>

              {/* Volume */}
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={state.volume}
                onChange={(e) => setVolume(stem.id, parseFloat(e.target.value))}
                className="w-16 h-1 accent-[var(--amber)] cursor-pointer"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
