"""Humanization, mixing, and file output."""

import shutil
from pathlib import Path

import numpy as np
import soundfile as sf

from .utils import TIMING_OFFSET_MS, DETUNE_CENTS, HARMONY_PAN


def humanize_harmony(harmony_audio: np.ndarray, sr: int) -> np.ndarray:
    """
    Apply subtle humanization: timing offset + micro-detuning.
    """
    import pyworld as pw

    offset_samples = int(TIMING_OFFSET_MS / 1000.0 * sr)
    delayed = np.zeros_like(harmony_audio)
    delayed[offset_samples:] = harmony_audio[:-offset_samples]

    audio_f64 = delayed.astype(np.float64)
    f0, t = pw.harvest(audio_f64, sr, f0_floor=65.0, f0_ceil=1500.0)
    sp = pw.cheaptrick(audio_f64, f0, t, sr)
    ap = pw.d4c(audio_f64, f0, t, sr)

    detune_ratio = 2.0 ** (DETUNE_CENTS / 1200.0)
    f0_detuned = f0 * detune_ratio

    detuned = pw.synthesize(f0_detuned, sp, ap, sr)

    if len(detuned) > len(harmony_audio):
        detuned = detuned[:len(harmony_audio)]
    elif len(detuned) < len(harmony_audio):
        detuned = np.pad(detuned, (0, len(harmony_audio) - len(detuned)))

    return detuned.astype(np.float32)


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

    harmony_humanized = humanize_harmony(harmony_audio, sr)
    harmony_scaled = harmony_humanized * harmony_volume

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
