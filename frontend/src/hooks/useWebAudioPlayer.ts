import { useRef, useState, useCallback, useEffect } from 'react';

interface UseWebAudioPlayerOptions {
  url: string | null;
  detune: number; // cents (semitones * 100)
  onTimeUpdate?: (time: number) => void;
}

export function useWebAudioPlayer({ url, detune, onTimeUpdate }: UseWebAudioPlayerOptions) {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const sourceIdRef = useRef(0);          // incremented on each new source
  const startedAtRef = useRef(0);
  const seekOffsetRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const animRef = useRef<number>(0);
  const playingRef = useRef(false);
  const detuneRef = useRef(detune);
  detuneRef.current = detune;
  const onTimeUpdateRef = useRef(onTimeUpdate);
  onTimeUpdateRef.current = onTimeUpdate;

  function stopCurrentSource() {
    sourceIdRef.current++;
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch {}
      sourceRef.current = null;
    }
    cancelAnimationFrame(animRef.current);
    playingRef.current = false;
    setPlaying(false);
  }

  function getPlaybackRate() {
    return Math.pow(2, detuneRef.current / 100 / 12);
  }

  function getCurrentTime() {
    if (!playingRef.current || !audioCtxRef.current) return seekOffsetRef.current;
    const rate = getPlaybackRate();
    const elapsed = (audioCtxRef.current.currentTime - startedAtRef.current) * rate;
    return Math.min(seekOffsetRef.current + elapsed, bufferRef.current?.duration ?? 0);
  }

  // Load audio buffer when URL changes
  useEffect(() => {
    if (!url) return;
    setLoading(true);

    // Save current state before stopping
    const wasPlaying = playingRef.current;
    const savedPosition = getCurrentTime();

    stopCurrentSource();

    const ctx = audioCtxRef.current ?? new AudioContext();
    audioCtxRef.current = ctx;

    fetch(url)
      .then(r => r.arrayBuffer())
      .then(ab => ctx.decodeAudioData(ab))
      .then(buffer => {
        bufferRef.current = buffer;
        setDuration(buffer.duration);
        setLoading(false);
        // Restore position (clamped to new buffer's duration)
        const pos = Math.min(savedPosition, buffer.duration);
        seekOffsetRef.current = pos;
        if (wasPlaying) {
          startSource(pos);
        } else {
          onTimeUpdateRef.current?.(pos);
        }
      })
      .catch(() => setLoading(false));
  }, [url]);

  function startSource(offset: number) {
    const ctx = audioCtxRef.current;
    const buffer = bufferRef.current;
    if (!ctx || !buffer) return;
    if (ctx.state === 'suspended') ctx.resume();

    const id = ++sourceIdRef.current;
    const rate = getPlaybackRate();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    source.connect(ctx.destination);

    source.onended = () => {
      // Only handle if this is still the active source
      if (sourceIdRef.current !== id) return;
      seekOffsetRef.current = buffer.duration;
      playingRef.current = false;
      setPlaying(false);
      cancelAnimationFrame(animRef.current);
      onTimeUpdateRef.current?.(buffer.duration);
    };

    startedAtRef.current = ctx.currentTime;
    seekOffsetRef.current = offset;
    source.start(0, offset);
    sourceRef.current = source;
    playingRef.current = true;
    setPlaying(true);

    // Start time update loop
    const loop = () => {
      if (!playingRef.current || sourceIdRef.current !== id) return;
      onTimeUpdateRef.current?.(getCurrentTime());
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }

  const play = useCallback(() => {
    startSource(seekOffsetRef.current);
  }, []);

  const pause = useCallback(() => {
    if (!playingRef.current) return;
    seekOffsetRef.current = getCurrentTime();
    stopCurrentSource();
    onTimeUpdateRef.current?.(seekOffsetRef.current);
  }, []);

  const seek = useCallback((time: number) => {
    const dur = bufferRef.current?.duration ?? 0;
    if (dur === 0) return;
    const clamped = Math.max(0, Math.min(time, dur));

    if (playingRef.current) {
      stopCurrentSource();
      startSource(clamped);
    } else {
      seekOffsetRef.current = clamped;
      onTimeUpdateRef.current?.(clamped);
    }
  }, []);

  const togglePlay = useCallback(() => {
    if (playingRef.current) pause();
    else play();
  }, [play, pause]);

  const getTime = useCallback(() => getCurrentTime(), []);

  // Update playback rate when detune changes during playback
  useEffect(() => {
    if (sourceRef.current && playingRef.current) {
      const pos = getCurrentTime();
      stopCurrentSource();
      startSource(pos);
    }
  }, [detune]);

  // Cleanup
  useEffect(() => {
    return () => {
      stopCurrentSource();
      audioCtxRef.current?.close();
    };
  }, []);

  return { playing, duration, loading, getTime, play, pause, seek, togglePlay };
}
