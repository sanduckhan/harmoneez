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
  const startedAtRef = useRef(0);      // audioCtx.currentTime when playback started
  const seekOffsetRef = useRef(0);     // song position where playback started
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const animRef = useRef<number>(0);
  const playingRef = useRef(false);
  const detuneRef = useRef(detune);
  detuneRef.current = detune;

  // Get current playback time
  const getTime = useCallback((): number => {
    if (!playingRef.current || !audioCtxRef.current) return seekOffsetRef.current;
    return seekOffsetRef.current + (audioCtxRef.current.currentTime - startedAtRef.current);
  }, []);

  // Load audio buffer when URL changes
  useEffect(() => {
    if (!url) return;
    setLoading(true);

    // Stop any current playback
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch {}
      sourceRef.current = null;
    }
    playingRef.current = false;
    setPlaying(false);

    const ctx = audioCtxRef.current ?? new AudioContext();
    audioCtxRef.current = ctx;

    fetch(url)
      .then(r => r.arrayBuffer())
      .then(ab => ctx.decodeAudioData(ab))
      .then(buffer => {
        bufferRef.current = buffer;
        setDuration(buffer.duration);
        seekOffsetRef.current = 0;
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [url]);

  // Update detune on playing source in real-time
  useEffect(() => {
    if (sourceRef.current) {
      sourceRef.current.detune.value = detune;
    }
  }, [detune]);

  // Time update animation loop
  const startTimeLoop = useCallback(() => {
    const loop = () => {
      if (!playingRef.current) return;
      onTimeUpdate?.(getTime());
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [getTime, onTimeUpdate]);

  const play = useCallback(() => {
    const ctx = audioCtxRef.current;
    const buffer = bufferRef.current;
    if (!ctx || !buffer) return;

    // Resume context if suspended (autoplay policy)
    if (ctx.state === 'suspended') ctx.resume();

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.detune.value = detuneRef.current;
    source.connect(ctx.destination);

    source.onended = () => {
      if (playingRef.current) {
        // Natural end — not a manual stop
        seekOffsetRef.current = buffer.duration;
        playingRef.current = false;
        setPlaying(false);
        cancelAnimationFrame(animRef.current);
      }
    };

    const offset = seekOffsetRef.current;
    startedAtRef.current = ctx.currentTime;
    source.start(0, offset);
    sourceRef.current = source;
    playingRef.current = true;
    setPlaying(true);
    startTimeLoop();
  }, [startTimeLoop]);

  const pause = useCallback(() => {
    if (!playingRef.current) return;
    seekOffsetRef.current = getTime();
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch {}
      sourceRef.current = null;
    }
    playingRef.current = false;
    setPlaying(false);
    cancelAnimationFrame(animRef.current);
    onTimeUpdate?.(seekOffsetRef.current);
  }, [getTime, onTimeUpdate]);

  const seek = useCallback((time: number) => {
    seekOffsetRef.current = Math.max(0, Math.min(time, bufferRef.current?.duration ?? 0));
    if (playingRef.current) {
      // Stop and restart from new position
      if (sourceRef.current) {
        try { sourceRef.current.stop(); } catch {}
        sourceRef.current = null;
      }
      playingRef.current = false;
      cancelAnimationFrame(animRef.current);
      play();
    } else {
      onTimeUpdate?.(seekOffsetRef.current);
    }
  }, [play, onTimeUpdate]);

  const togglePlay = useCallback(() => {
    if (playingRef.current) pause();
    else play();
  }, [play, pause]);

  // Cleanup
  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (sourceRef.current) {
        try { sourceRef.current.stop(); } catch {}
      }
      audioCtxRef.current?.close();
    };
  }, []);

  return { playing, duration, loading, getTime, play, pause, seek, togglePlay };
}
