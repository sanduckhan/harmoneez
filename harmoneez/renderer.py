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


def _midi_to_hz(m: int) -> float:
    return 440.0 * (2.0 ** ((m - 69) / 12.0))


def render_harmony(
    vocals_audio: np.ndarray,
    sr: int,
    harmony_notes: list[HarmonyNote],
    world_analysis: tuple | None = None,
    formant_factor: float = 1.0,
    detune_cents: float = DETUNE_CENTS,
    in_tune: bool = False,
    vibrato_dampen: float = 0.5,
) -> np.ndarray:
    """
    Pitch-shift the vocal track using WORLD vocoder for formant-preserving rendering.
    If world_analysis is provided, skips the expensive analysis step.

    in_tune: if True, snap each harmony note's centre pitch to the absolute
        MIDI grid (so harmony stays in tune even if the lead is detuned).
        Vibrato/contour relative to the note's median is preserved.
    vibrato_dampen: 0..1 — how much to flatten the lead's F0 contour for the
        harmony only. 0 = harmony follows lead exactly (parallel-vibrato clone),
        1 = harmony is rock-steady on the median pitch. ~0.5 reads as a
        different, steadier backing voice.
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

    # Vibrato dampening for the harmony only: build a smoothed version of the
    # raw F0 in log space, then blend toward it. This keeps the harmony's
    # micro-contour from being a perfect parallel of the lead's vibrato.
    if voiced_mask.any() and vibrato_dampen > 0.0:
        voiced_idx = np.where(voiced_mask)[0]
        log_f0_voiced = np.log2(np.maximum(f0[voiced_mask], 1.0))
        # Hold voiced values across unvoiced gaps so smoothing doesn't pull
        # boundary frames toward zero.
        log_f0_filled = np.interp(np.arange(len(f0)), voiced_idx, log_f0_voiced)
        frame_dur = float(timeaxis[1] - timeaxis[0]) if len(timeaxis) > 1 else 0.005
        smooth_win = max(1, int(0.05 / frame_dur))  # ~50 ms — under one vibrato cycle
        if smooth_win >= 2:
            kernel = np.ones(smooth_win) / smooth_win
            log_f0_smooth = np.convolve(log_f0_filled, kernel, mode='same')
        else:
            log_f0_smooth = log_f0_filled
        log_f0_blend = (1.0 - vibrato_dampen) * log_f0_filled + vibrato_dampen * log_f0_smooth
        f0_for_harmony = np.where(voiced_mask, 2.0 ** log_f0_blend, 0.0)
    else:
        f0_for_harmony = f0

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
        if in_tune:
            # Compute shift so the median harmony F0 lands exactly on the
            # target harmony_midi pitch — independent of how detuned the lead is.
            voiced_in_note = in_range & voiced_mask
            if voiced_in_note.any():
                median_f0 = float(np.median(f0_for_harmony[voiced_in_note]))
                if median_f0 > 1.0:
                    target_hz = _midi_to_hz(hn.harmony_midi)
                    log_shift[mask] = np.log2(target_hz / median_f0) + log_detune
                    covered |= in_range
                    continue
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
        f0_shifted[apply_mask] = f0_for_harmony[apply_mask] * ratios[apply_mask]

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
