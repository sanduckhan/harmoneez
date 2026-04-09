"""Frame-by-frame pitch correction using WORLD vocoder."""

import numpy as np

from .utils import (
    MAX_HARMONY_MIDI, MIN_HARMONY_MIDI,
    PITCH_CORRECT_STRENGTH, PITCH_CORRECT_THRESHOLD,
    build_scale_pitch_classes,
)


def build_scale_hz(key_name: str) -> list[float]:
    """Return Hz values for all scale degrees across the vocal range (C2-C6)."""
    scale_pcs = build_scale_pitch_classes(key_name)
    hz_targets = []
    for octave_midi in range(24, 85, 12):
        for pc in scale_pcs:
            midi = octave_midi + pc
            if midi < MIN_HARMONY_MIDI or midi > MAX_HARMONY_MIDI:
                continue
            hz = 440.0 * (2.0 ** ((midi - 69) / 12.0))
            hz_targets.append(hz)
    return sorted(hz_targets)


def find_nearest_scale_hz(hz: float, scale_hz: list[float]) -> float:
    """Find the nearest Hz value in the scale target list."""
    best = scale_hz[0]
    best_dist = abs(1200 * np.log2(hz / best))
    for target in scale_hz[1:]:
        dist = abs(1200 * np.log2(hz / target))
        if dist < best_dist:
            best = target
            best_dist = dist
    return best


def pitch_correct_vocals(
    vocals_audio: np.ndarray,
    sr: int,
    note_events: list[tuple[float, float, int, float]],
    key_name: str,
    strength: float = PITCH_CORRECT_STRENGTH,
) -> tuple[np.ndarray, int, int, list[dict]]:
    """
    Frame-by-frame pitch correction using WORLD vocoder.
    Returns (corrected_audio, corrected_count, total_voiced, pitch_frames).
    pitch_frames is a list of dicts with time, actual_hz, target_hz, deviation_cents.
    """
    import pyworld as pw

    scale_hz = build_scale_hz(key_name)
    audio_f64 = vocals_audio.astype(np.float64)

    f0, timeaxis = pw.harvest(audio_f64, sr, f0_floor=65.0, f0_ceil=1000.0)
    sp = pw.cheaptrick(audio_f64, f0, timeaxis, sr)
    ap = pw.d4c(audio_f64, f0, timeaxis, sr)

    corrected_f0 = f0.copy()
    corrected_count = 0
    pitch_frames = []

    for i in range(len(f0)):
        frame = {"time": float(timeaxis[i])}

        if f0[i] < 1.0:
            frame["actual_hz"] = None
            frame["target_hz"] = None
            frame["deviation_cents"] = None
            pitch_frames.append(frame)
            continue

        actual_hz = f0[i]
        target_hz = find_nearest_scale_hz(actual_hz, scale_hz)
        deviation_cents = 1200.0 * np.log2(actual_hz / target_hz)

        frame["actual_hz"] = round(float(actual_hz), 1)
        frame["target_hz"] = round(float(target_hz), 1)
        frame["deviation_cents"] = round(float(deviation_cents), 1)
        pitch_frames.append(frame)

        if abs(deviation_cents) < PITCH_CORRECT_THRESHOLD * 100:
            continue

        correction_ratio = 2.0 ** ((-deviation_cents * strength) / 1200.0)
        corrected_f0[i] = actual_hz * correction_ratio
        corrected_count += 1

    output = pw.synthesize(corrected_f0, sp, ap, sr)

    if len(output) > len(vocals_audio):
        output = output[:len(vocals_audio)]
    elif len(output) < len(vocals_audio):
        output = np.pad(output, (0, len(vocals_audio) - len(output)))

    total_voiced = int(np.sum(f0 > 1.0))
    return output.astype(np.float32), corrected_count, total_voiced, pitch_frames
