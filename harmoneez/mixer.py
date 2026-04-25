"""Humanization, mixing, and file output."""

import shutil
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import sosfilt, butter

from .utils import TIMING_OFFSET_MS, HARMONY_PAN

# ── Harmony post-processing constants ────────────────────────────────────────

# High-pass: remove low-end mud from harmony (Hz)
HARMONY_HPF_FREQ = 180.0
# Presence dip: reduce 2–4 kHz so harmony doesn't compete with lead vocal
PRESENCE_DIP_LOW = 2000.0
PRESENCE_DIP_HIGH = 4000.0
PRESENCE_DIP_DB = -4.0
# High shelf rolloff above 8 kHz (tames sibilance/artifacts)
HARMONY_LPF_FREQ = 8000.0

# Reverb: algorithmic plate-style (Schroeder)
REVERB_MIX = 0.20       # wet/dry ratio (0=dry, 1=fully wet)
REVERB_DECAY = 0.45      # RT60-ish decay factor (0-1)
REVERB_PREDELAY_MS = 18  # predelay pushes reverb slightly behind


def apply_timing_offset(harmony_audio: np.ndarray, sr: int) -> np.ndarray:
    """
    Shift the harmony track forward by TIMING_OFFSET_MS milliseconds.

    This is half of the previous humanize_harmony: the micro-detuning that
    used to live here has been folded into render_harmony's shift ratio so
    we don't have to run a second WORLD analysis pass per interval.
    """
    offset_samples = int(TIMING_OFFSET_MS / 1000.0 * sr)
    if offset_samples <= 0 or offset_samples >= len(harmony_audio):
        return harmony_audio
    delayed = np.zeros_like(harmony_audio)
    delayed[offset_samples:] = harmony_audio[:-offset_samples]
    return delayed


def _eq_harmony(audio: np.ndarray, sr: int) -> np.ndarray:
    """
    Apply EQ to the harmony stem to sit it behind the lead vocal:
    - High-pass at 180 Hz (remove mud)
    - Dip 2-4 kHz by ~4 dB (reduce presence/intelligibility competition)
    - Low-pass at 8 kHz (tame sibilance and WORLD artifacts)
    """
    nyq = sr / 2.0
    out = audio.copy()

    # High-pass
    if HARMONY_HPF_FREQ < nyq:
        sos = butter(2, HARMONY_HPF_FREQ / nyq, btype='high', output='sos')
        out = sosfilt(sos, out).astype(np.float32)

    # Presence dip: bandpass the 2-4 kHz region and subtract it (scaled)
    if PRESENCE_DIP_HIGH < nyq:
        sos_bp = butter(2, [PRESENCE_DIP_LOW / nyq, PRESENCE_DIP_HIGH / nyq], btype='band', output='sos')
        presence = sosfilt(sos_bp, out).astype(np.float32)
        # Convert dB to linear scale for subtraction
        dip_factor = 1.0 - 10.0 ** (PRESENCE_DIP_DB / 20.0)  # ~0.37 for -4dB
        out = out - presence * dip_factor

    # Low-pass (gentle rolloff)
    if HARMONY_LPF_FREQ < nyq:
        sos = butter(2, HARMONY_LPF_FREQ / nyq, btype='low', output='sos')
        out = sosfilt(sos, out).astype(np.float32)

    return out


def _reverb(audio: np.ndarray, sr: int) -> np.ndarray:
    """
    Simple algorithmic plate reverb using Schroeder structure:
    4 comb filters in parallel → 2 allpass filters in series.
    Light and fast — no convolution IR needed.
    """
    # Predelay
    predelay_samples = int(REVERB_PREDELAY_MS / 1000.0 * sr)
    n = len(audio)

    # Comb filter delay times (in ms) — tuned to avoid metallic resonance
    comb_delays_ms = [29.7, 37.1, 41.1, 43.7]
    # Allpass delay times
    allpass_delays_ms = [5.0, 1.7]

    def comb_filter(x, delay_ms, decay):
        delay_samples = int(delay_ms / 1000.0 * sr)
        y = np.zeros(n + delay_samples, dtype=np.float64)
        for i in range(n):
            y[i + delay_samples] += x[i] + decay * y[i]
        return y[:n].astype(np.float32)

    def allpass_filter(x, delay_ms, decay=0.5):
        delay_samples = int(delay_ms / 1000.0 * sr)
        y = np.zeros(n, dtype=np.float64)
        buf = np.zeros(delay_samples, dtype=np.float64)
        pos = 0
        for i in range(n):
            delayed = buf[pos]
            buf[pos] = x[i] + decay * delayed
            y[i] = delayed - decay * buf[pos]
            pos = (pos + 1) % delay_samples
        return y.astype(np.float32)

    # Parallel comb filters
    wet = np.zeros(n, dtype=np.float32)
    for delay_ms in comb_delays_ms:
        wet += comb_filter(audio, delay_ms, REVERB_DECAY)
    wet /= len(comb_delays_ms)

    # Series allpass filters
    for delay_ms in allpass_delays_ms:
        wet = allpass_filter(wet, delay_ms)

    # Predelay
    if predelay_samples > 0:
        delayed_wet = np.zeros_like(wet)
        delayed_wet[predelay_samples:] = wet[:-predelay_samples]
        wet = delayed_wet

    return wet


def process_harmony(audio: np.ndarray, sr: int) -> np.ndarray:
    """Apply EQ + reverb to a harmony stem to blend it behind the lead vocal."""
    eqd = _eq_harmony(audio, sr)
    wet = _reverb(eqd, sr)
    return eqd * (1.0 - REVERB_MIX) + wet * REVERB_MIX


def mix_and_save(
    vocals_audio: np.ndarray,
    harmony_audio: np.ndarray,
    sr: int,
    input_path: Path,
    harmony_volume: float,
    interval_label: str = '',
    output_dir: Path | None = None,
) -> tuple[Path, Path]:
    """
    Save harmony-only (mono) and mixed (stereo) WAV files.
    """
    stem = input_path.stem
    if output_dir is None:
        output_dir = input_path.parent

    suffix = f"_{interval_label}" if interval_label else ""
    harmony_path = output_dir / f"{stem}{suffix}_harmony.wav"
    mixed_path = output_dir / f"{stem}{suffix}_mixed.wav"

    harmony_humanized = apply_timing_offset(harmony_audio, sr)
    harmony_processed = process_harmony(harmony_humanized, sr)
    harmony_scaled = harmony_processed * harmony_volume

    # Harmony-only output (mono)
    harmony_out = harmony_scaled.copy()
    max_harm = np.max(np.abs(harmony_out))
    if max_harm > 1.0:
        harmony_out /= max_harm
    sf.write(str(harmony_path), harmony_out, sr)

    # Mixed output (stereo with panning)
    lead_left = vocals_audio * (0.5 + HARMONY_PAN * 0.5)
    lead_right = vocals_audio * (0.5 - HARMONY_PAN * 0.5)
    harm_left = harmony_scaled * (0.5 - HARMONY_PAN * 0.5)
    harm_right = harmony_scaled * (0.5 + HARMONY_PAN * 0.5)

    left = lead_left + harm_left
    right = lead_right + harm_right

    stereo = np.column_stack([left, right])

    max_val = np.max(np.abs(stereo))
    if max_val > 1.0:
        stereo /= max_val

    sf.write(str(mixed_path), stereo, sr)

    return harmony_path, mixed_path


def cleanup(tmp_dir: Path):
    """Remove the temporary directory and all its contents."""
    try:
        shutil.rmtree(str(tmp_dir), ignore_errors=True)
    except Exception:
        pass
