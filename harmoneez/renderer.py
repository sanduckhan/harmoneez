"""Harmony audio rendering using WORLD vocoder."""

import numpy as np

from .utils import (
    HarmonyNote, SEGMENT_PAD_MS, MIN_SEGMENT_SAMPLES, CROSSFADE_MS,
    DETUNE_CENTS, PORTAMENTO_MS,
)


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


def _shift_formants(sp: np.ndarray, factor: float) -> np.ndarray:
    """
    Resample the spectral envelope along the frequency axis by `factor`.
    factor > 1.0 lifts formants (a peak at bin k moves to bin k*factor);
    factor < 1.0 lowers them.
    """
    if abs(factor - 1.0) < 1e-3:
        return sp
    n_bins = sp.shape[1]
    bins = np.arange(n_bins)
    query = bins / factor  # out[k] = sp[k/factor] → peaks shift up by `factor`
    out = np.empty_like(sp)
    for i in range(sp.shape[0]):
        out[i] = np.interp(query, bins, sp[i])
    np.maximum(out, 1e-12, out=out)
    return out


def render_harmony(
    vocals_audio: np.ndarray,
    sr: int,
    harmony_notes: list[HarmonyNote],
    world_analysis: tuple | None = None,
    formant_factor: float = 1.0,
    detune_cents: float = DETUNE_CENTS,
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

    if formant_factor != 1.0:
        sp = _shift_formants(sp, formant_factor)

    pad_sec = SEGMENT_PAD_MS / 1000.0
    voiced_mask = f0 > 1.0

    # Build per-frame shift in log2 space so smoothing is musically linear
    # (cents = 1200 * log2). Frames not covered by any harmony note get
    # NaN as a sentinel; we forward/backward-fill before smoothing so that
    # phrase edges don't drift toward shift_ratio=1.0.
    log_shift = np.full_like(f0, np.nan, dtype=np.float64)
    log_detune = detune_cents / 1200.0
    sorted_notes = sorted(harmony_notes, key=lambda n: n.start_time)
    covered = np.zeros_like(f0, dtype=bool)
    for hn in sorted_notes:
        in_range = (timeaxis >= hn.start_time - pad_sec) & (timeaxis <= hn.end_time + pad_sec)
        mask = in_range & ~covered
        log_shift[mask] = (hn.semitone_shift / 12.0) + log_detune
        covered |= in_range

    f0_shifted = np.zeros_like(f0)
    if covered.any():
        cov_idx = np.where(covered)[0]
        all_idx = np.arange(len(log_shift))
        # nearest-neighbor extension into uncovered regions
        log_shift_filled = np.interp(all_idx, cov_idx, log_shift[cov_idx])

        # Smooth ratio transitions across note boundaries with a moving average.
        # Width corresponds to PORTAMENTO_MS at WORLD's frame rate (~5 ms).
        frame_dur = float(timeaxis[1] - timeaxis[0]) if len(timeaxis) > 1 else 0.005
        win = max(1, int(PORTAMENTO_MS / 1000.0 / frame_dur))
        if win >= 2:
            kernel = np.ones(win) / win
            log_shift_smooth = np.convolve(log_shift_filled, kernel, mode='same')
        else:
            log_shift_smooth = log_shift_filled

        ratios = 2.0 ** log_shift_smooth
        apply_mask = voiced_mask & covered
        f0_shifted[apply_mask] = f0[apply_mask] * ratios[apply_mask]

    raw_output = pw.synthesize(f0_shifted, sp, ap, sr)

    if len(raw_output) > len(vocals_audio):
        raw_output = raw_output[:len(vocals_audio)]
    elif len(raw_output) < len(vocals_audio):
        raw_output = np.pad(raw_output, (0, len(vocals_audio) - len(raw_output)))

    # Build a smooth gate envelope from the union of note ranges. Adjacent or
    # overlapping notes form one continuous gate (no volume duck at internal
    # boundaries), while isolated notes still get a soft fade-in/out at the edges.
    pad_samples = int(SEGMENT_PAD_MS / 1000.0 * sr)
    envelope = np.zeros(len(vocals_audio), dtype=np.float32)
    for hn in harmony_notes:
        start_sample = max(0, int(hn.start_time * sr) - pad_samples)
        end_sample = min(len(envelope), int(hn.end_time * sr) + pad_samples)
        if end_sample - start_sample >= MIN_SEGMENT_SAMPLES:
            envelope[start_sample:end_sample] = 1.0

    crossfade_samples = int(CROSSFADE_MS / 1000.0 * sr)
    if crossfade_samples >= 2:
        kernel = np.ones(crossfade_samples, dtype=np.float32) / crossfade_samples
        envelope = np.convolve(envelope, kernel, mode='same').astype(np.float32)

    return (raw_output * envelope).astype(np.float32)
