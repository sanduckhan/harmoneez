"""Harmony audio rendering using WORLD vocoder."""

import numpy as np

from .utils import (
    HarmonyNote, SEGMENT_PAD_MS, MIN_SEGMENT_SAMPLES, CROSSFADE_MS, DETUNE_CENTS,
)


# Subtle pitch detune applied during synthesis — used to be done in a second
# WORLD pass in mixer.humanize_harmony, but it's equivalent (and ~Nx cheaper
# across N intervals) to fold it into the existing shift ratio here.
_DETUNE_RATIO = 2.0 ** (DETUNE_CENTS / 1200.0)


def analyze_world(vocals_audio: np.ndarray, sr: int) -> tuple:
    """
    Run WORLD vocoder analysis once. Returns (f0, timeaxis, sp, ap).
    Reuse across multiple render_harmony calls to avoid redundant analysis.
    """
    import pyworld as pw

    audio_f64 = vocals_audio.astype(np.float64)
    f0, timeaxis = pw.harvest(audio_f64, sr, f0_floor=65.0, f0_ceil=1000.0)
    sp = pw.cheaptrick(audio_f64, f0, timeaxis, sr)
    ap = pw.d4c(audio_f64, f0, timeaxis, sr)
    return f0, timeaxis, sp, ap


def render_harmony(
    vocals_audio: np.ndarray,
    sr: int,
    harmony_notes: list[HarmonyNote],
    world_analysis: tuple | None = None,
) -> np.ndarray:
    """
    Pitch-shift the vocal track using WORLD vocoder for formant-preserving rendering.
    If world_analysis is provided, skips the expensive analysis step.
    """
    import pyworld as pw

    if world_analysis:
        f0, timeaxis, sp, ap = world_analysis
    else:
        f0, timeaxis, sp, ap = analyze_world(vocals_audio, sr)

    f0_shifted = np.zeros_like(f0)
    pad_sec = SEGMENT_PAD_MS / 1000.0
    voiced_mask = f0 > 1.0

    for hn in harmony_notes:
        shift_ratio = 2.0 ** (hn.semitone_shift / 12.0) * _DETUNE_RATIO
        in_range = (timeaxis >= hn.start_time - pad_sec) & (timeaxis <= hn.end_time + pad_sec)
        mask = in_range & voiced_mask & (f0_shifted < 1.0)
        f0_shifted[mask] = f0[mask] * shift_ratio

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
