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

// Maximum jump in semitones between consecutive frames before we reject as octave error
const MAX_JUMP_SEMITONES = 7;
// Number of consecutive frames a new pitch must hold to be accepted after a jump
const CONFIRM_FRAMES = 3;

export function usePitchDetection({
  stream,
  enabled,
  clarityThreshold = 0.8,
  onPitchDetected,
  getElapsedTime,
}: UsePitchDetectionOptions) {
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
    let lastMidi: number | null = null;
    let jumpCandidate: number | null = null;
    let jumpCount = 0;

    function detect() {
      analyser.getFloatTimeDomainData(buffer);
      const [pitch, clarity] = detector.findPitch(buffer, audioCtx.sampleRate);

      const time = getTimeRef.current();

      if (clarity >= thresholdRef.current && pitch > 50 && pitch < 1500) {
        const midi = 12 * Math.log2(pitch / 440) + 69;

        // Filter octave errors: reject sudden large jumps unless sustained
        let accepted = true;
        if (lastMidi !== null) {
          const jump = Math.abs(midi - lastMidi);
          if (jump > MAX_JUMP_SEMITONES) {
            // Possible octave error — need confirmation
            if (jumpCandidate !== null && Math.abs(midi - jumpCandidate) < 2) {
              jumpCount++;
              if (jumpCount >= CONFIRM_FRAMES) {
                // Sustained at new pitch — accept it
                lastMidi = midi;
                jumpCandidate = null;
                jumpCount = 0;
              } else {
                accepted = false;
              }
            } else {
              // New jump candidate
              jumpCandidate = midi;
              jumpCount = 1;
              accepted = false;
            }
          } else {
            // Normal movement — reset jump tracking
            jumpCandidate = null;
            jumpCount = 0;
            lastMidi = midi;
          }
        } else {
          lastMidi = midi;
        }

        if (accepted) {
          onPitchRef.current({ time, hz: pitch, midi, clarity });
        } else {
          // Emit null for rejected frames (keeps timeline continuous)
          onPitchRef.current({ time, hz: null, midi: null, clarity });
        }
      } else {
        lastMidi = null;
        jumpCandidate = null;
        jumpCount = 0;
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
