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


def pitch_correct_vocals(
    vocals_audio: np.ndarray,
    sr: int,
    note_events: list[tuple[float, float, int, float]],
    key_name: str,
    strength: float = PITCH_CORRECT_STRENGTH,
) -> tuple[np.ndarray, int, int, list[dict], tuple]:
    """
    Frame-by-frame pitch correction using WORLD vocoder.

    Returns (corrected_audio, corrected_count, total_voiced, pitch_frames, world_analysis).
    - pitch_frames is a list of dicts with time, actual_hz, target_hz, deviation_cents.
    - world_analysis is a (corrected_f0, timeaxis, sp, ap) tuple that can be passed
      directly to render_harmony() to skip a redundant analysis pass.
    """
    import pyworld as pw

    scale_hz = np.asarray(build_scale_hz(key_name), dtype=np.float64)
    audio_f64 = vocals_audio.astype(np.float64)

    f0, timeaxis = pw.harvest(audio_f64, sr, f0_floor=65.0, f0_ceil=1000.0)
    sp = pw.cheaptrick(audio_f64, f0, timeaxis, sr)
    ap = pw.d4c(audio_f64, f0, timeaxis, sr)

    voiced = f0 > 1.0
    # Safe log base for unvoiced frames (value is masked out later)
    safe_f0 = np.where(voiced, f0, 1.0)
    log_actual = np.log2(safe_f0)
    log_targets = np.log2(scale_hz)

    # Distance matrix of cents: |1200 * (log_actual[:, None] - log_targets[None, :])|
    # We work in log2 space and only multiply by 1200 at the end; argmin is
    # invariant to the constant factor.
    dist = np.abs(log_actual[:, None] - log_targets[None, :])
    nearest_idx = np.argmin(dist, axis=1)
    target_hz_arr = scale_hz[nearest_idx]

    deviation_cents = 1200.0 * (log_actual - np.log2(target_hz_arr))

    threshold_cents = PITCH_CORRECT_THRESHOLD * 100
    correction_mask = voiced & (np.abs(deviation_cents) >= threshold_cents)
    correction_ratio = np.where(
        correction_mask,
        2.0 ** ((-deviation_cents * strength) / 1200.0),
        1.0,
    )
    corrected_f0 = f0 * correction_ratio
    corrected_count = int(np.sum(correction_mask))

    # Build pitch_frames — preserve the exact dict shape the frontend expects
    # (see frontend/src/api.ts: { time, actual_hz, target_hz, deviation_cents }).
    actual_rounded = np.round(f0, 1)
    target_rounded = np.round(target_hz_arr, 1)
    dev_rounded = np.round(deviation_cents, 1)
    times = timeaxis.tolist()
    voiced_list = voiced.tolist()
    actual_list = actual_rounded.tolist()
    target_list = target_rounded.tolist()
    dev_list = dev_rounded.tolist()
    pitch_frames = [
        {
            "time": float(times[i]),
            "actual_hz": float(actual_list[i]) if voiced_list[i] else None,
            "target_hz": float(target_list[i]) if voiced_list[i] else None,
            "deviation_cents": float(dev_list[i]) if voiced_list[i] else None,
        }
        for i in range(len(f0))
    ]

    output = pw.synthesize(corrected_f0, sp, ap, sr)

    if len(output) > len(vocals_audio):
        output = output[:len(vocals_audio)]
    elif len(output) < len(vocals_audio):
        output = np.pad(output, (0, len(vocals_audio) - len(output)))

    total_voiced = int(np.sum(voiced))
    world_analysis = (corrected_f0, timeaxis, sp, ap)
    return (
        output.astype(np.float32),
        corrected_count,
        total_voiced,
        pitch_frames,
        world_analysis,
    )
