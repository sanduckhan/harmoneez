import { useEffect, useRef } from 'react';
import { PitchDetector } from 'pitchy';
import type { PitchSample } from '../types';

interface UsePitchDetectionOptions {
  stream: MediaStream | null;
  enabled: boolean;
  clarityThreshold?: number;
  onPitchDetected: (sample: PitchSample) => void;
  getElapsedTime: () => number;
}

export function usePitchDetection({
  stream,
  enabled,
  clarityThreshold = 0.8,
  onPitchDetected,
  getElapsedTime,
}: UsePitchDetectionOptions) {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    if (!stream || !enabled) return;

    const audioCtx = new AudioContext();
    audioCtxRef.current = audioCtx;

    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    const buffer = new Float32Array(analyser.fftSize);
    const detector = PitchDetector.forFloat32Array(analyser.fftSize);

    function detect() {
      analyser.getFloatTimeDomainData(buffer);
      const [pitch, clarity] = detector.findPitch(buffer, audioCtx.sampleRate);

      const time = getElapsedTime();

      if (clarity >= clarityThreshold && pitch > 50 && pitch < 1500) {
        const midi = 12 * Math.log2(pitch / 440) + 69;
        onPitchDetected({ time, hz: pitch, midi, clarity });
      } else {
        onPitchDetected({ time, hz: null, midi: null, clarity });
      }

      animRef.current = requestAnimationFrame(detect);
    }

    animRef.current = requestAnimationFrame(detect);

    return () => {
      cancelAnimationFrame(animRef.current);
      audioCtx.close();
      audioCtxRef.current = null;
    };
  }, [stream, enabled]);
}
