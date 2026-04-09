"""Harmony audio rendering using WORLD vocoder."""

import numpy as np

from .utils import (
    HarmonyNote, SEGMENT_PAD_MS, MIN_SEGMENT_SAMPLES, CROSSFADE_MS,
)


def render_harmony(
    vocals_audio: np.ndarray,
    sr: int,
    harmony_notes: list[HarmonyNote],
) -> np.ndarray:
    """
    Pitch-shift the vocal track using WORLD vocoder for formant-preserving rendering.
    Analyzes the full track once, then builds a per-frame F0 target from harmony notes.
    """
    import pyworld as pw

    audio_f64 = vocals_audio.astype(np.float64)

    f0, timeaxis = pw.harvest(audio_f64, sr, f0_floor=65.0, f0_ceil=1000.0)
    sp = pw.cheaptrick(audio_f64, f0, timeaxis, sr)
    ap = pw.d4c(audio_f64, f0, timeaxis, sr)

    f0_shifted = np.zeros_like(f0)

    for hn in harmony_notes:
        shift_ratio = 2.0 ** (hn.semitone_shift / 12.0)
        pad_sec = SEGMENT_PAD_MS / 1000.0

        for i in range(len(timeaxis)):
            t = timeaxis[i]
            if t < hn.start_time - pad_sec or t > hn.end_time + pad_sec:
                continue
            if f0[i] < 1.0:
                continue
            if f0_shifted[i] < 1.0:
                f0_shifted[i] = f0[i] * shift_ratio

    raw_output = pw.synthesize(f0_shifted, sp, ap, sr)

    if len(raw_output) > len(vocals_audio):
        raw_output = raw_output[:len(vocals_audio)]
    elif len(raw_output) < len(vocals_audio):
        raw_output = np.pad(raw_output, (0, len(vocals_audio) - len(raw_output)))

    # Gate: only keep WORLD output during note segments
    output = np.zeros_like(vocals_audio)
    crossfade_samples = int(CROSSFADE_MS / 1000.0 * sr)
    pad_samples = int(SEGMENT_PAD_MS / 1000.0 * sr)

    for hn in harmony_notes:
        start_sample = max(0, int(hn.start_time * sr) - pad_samples)
        end_sample = min(len(output), int(hn.end_time * sr) + pad_samples)
        seg_len = end_sample - start_sample
        if seg_len < MIN_SEGMENT_SAMPLES:
            continue

        segment = raw_output[start_sample:end_sample].copy()

        cf = min(crossfade_samples, seg_len // 2)
        if cf > 0:
            segment[:cf] *= np.linspace(0, 1, cf)
            segment[seg_len - cf:seg_len] *= np.linspace(1, 0, cf)

        output[start_sample:end_sample] = segment

    return output.astype(np.float32)
