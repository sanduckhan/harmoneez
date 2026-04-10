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
  // Store callbacks in refs to avoid stale closures
  const onPitchRef = useRef(onPitchDetected);
  onPitchRef.current = onPitchDetected;
  const getTimeRef = useRef(getElapsedTime);
  getTimeRef.current = getElapsedTime;
  const thresholdRef = useRef(clarityThreshold);
  thresholdRef.current = clarityThreshold;

  useEffect(() => {
    if (!stream || !enabled) return;

    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    const buffer = new Float32Array(analyser.fftSize);
    const detector = PitchDetector.forFloat32Array(analyser.fftSize);
    let animFrame = 0;

    function detect() {
      analyser.getFloatTimeDomainData(buffer);
      const [pitch, clarity] = detector.findPitch(buffer, audioCtx.sampleRate);

      const time = getTimeRef.current();

      if (clarity >= thresholdRef.current && pitch > 50 && pitch < 1500) {
        const midi = 12 * Math.log2(pitch / 440) + 69;
        onPitchRef.current({ time, hz: pitch, midi, clarity });
      } else {
        onPitchRef.current({ time, hz: null, midi: null, clarity });
      }

      animFrame = requestAnimationFrame(detect);
    }

    animFrame = requestAnimationFrame(detect);

    return () => {
      cancelAnimationFrame(animFrame);
      audioCtx.close();
    };
  }, [stream, enabled]);
}
