"""Prepare pipeline: vocal separation, optional transpose, melody extraction."""

import json
from pathlib import Path
from typing import Callable, Optional

import numpy as np
import pyworld as pw
import soundfile as sf

from .separation import separate_vocals
from .pitch_shift import pitch_shift_librosa
from .note_segmentation import f0_contour_to_notes

ProgressCallback = Callable[[str, str, int, int], None]

# Fraction of median voiced-frame RMS below which F0 is zeroed out.
# Filters quiet instrument bleed (synth/piano) from Demucs vocal stem.
BLEED_GATE_RATIO = 0.15


def _noop_progress(step: str, message: str, step_num: int, total_steps: int):
    pass


def _compute_frame_rms(audio: np.ndarray, hop_samples: int, n_frames: int) -> np.ndarray:
    """Vectorized per-frame RMS energy."""
    padded_len = n_frames * hop_samples
    padded = np.zeros(padded_len, dtype=np.float64)
    copy_len = min(len(audio), padded_len)
    padded[:copy_len] = audio[:copy_len]
    return np.sqrt(np.mean(padded.reshape(n_frames, hop_samples) ** 2, axis=1))


def run_prepare(
    input_path: str | Path,
    tmp_dir: str | Path,
    transpose: int = 0,
    key: str = "",
    duration: float = 0,
    on_progress: Optional[ProgressCallback] = None,
) -> dict:
    """
    Separate vocals from instrumental, optionally transpose both stems,
    extract melody + pitch contour + amplitude.

    Demucs runs on the ORIGINAL audio for best separation quality.
    Transpose (if any) is applied AFTER separation using librosa phase vocoder
    on both stems independently. This avoids WORLD vocoder artifacts on
    polyphonic vocals (multiple singers) and avoids feeding Demucs
    pitch-shifted audio (which degrades separation).

    Args:
        input_path: Path to the uploaded audio file.
        tmp_dir: Working directory for intermediate files.
        transpose: Semitones to shift (-6 to +6). 0 = no transpose.
        key: Pre-detected key name (e.g. "Eb minor"). Already transposed if transpose != 0.
        duration: Song duration in seconds (for time estimates).
        on_progress: Callback for progress updates.

    Returns:
        dict with keys: key, melody_count, duration.
    """
    if on_progress is None:
        on_progress = _noop_progress

    tmp_dir = Path(tmp_dir)
    total_steps = 3 if transpose != 0 else 2
    step = 0

    # Separate vocals from original audio (Demucs works best on unmodified input)
    step += 1
    estimate = max(5, int(duration * 0.07))
    on_progress("separating", f"Isolating vocals... (~{estimate}s)", step, total_steps)
    vocals_audio, instrumental_audio, sr = separate_vocals(input_path, tmp_dir)

    # Transpose both stems with librosa (handles polyphonic content)
    if transpose != 0:
        step += 1
        on_progress("transposing", "Transposing vocals and instrumental...", step, total_steps)
        vocals_audio = pitch_shift_librosa(vocals_audio, sr, transpose)
        instrumental_audio = pitch_shift_librosa(instrumental_audio, sr, transpose)
        sf.write(str(tmp_dir / "vocals.wav"), vocals_audio, sr)
        sf.write(str(tmp_dir / "instrumental.wav"), instrumental_audio, sr)

    # Create full mix from stems
    full_mix = vocals_audio + instrumental_audio
    max_val = np.max(np.abs(full_mix))
    if max_val > 1.0:
        full_mix = full_mix / max_val
    sf.write(str(tmp_dir / "full_mix.wav"), full_mix, sr)

    # Extract melody via WORLD F0 contour
    step += 1
    on_progress("extracting_melody", "Extracting melody...", step, total_steps)

    audio_f64 = vocals_audio.astype(np.float64)
    f0, timeaxis = pw.harvest(audio_f64, sr, f0_floor=65.0, f0_ceil=1000.0)
    frame_dur = float(timeaxis[1] - timeaxis[0]) if len(timeaxis) > 1 else 0.005
    hop_samples = max(1, int(frame_dur * sr))

    # Amplitude-gate F0: zero out frames where vocal RMS is too quiet
    # (filters instrument bleed from Demucs — synth/piano in vocal range)
    frame_rms = _compute_frame_rms(vocals_audio, hop_samples, len(f0))
    voiced_rms = frame_rms[f0 > 1.0]
    if len(voiced_rms) > 0:
        f0[frame_rms < np.median(voiced_rms) * BLEED_GATE_RATIO] = 0.0

    world_notes = f0_contour_to_notes(f0, timeaxis, vocals_audio, sr)

    with open(tmp_dir / "melody_data.json", 'w') as f:
        json.dump(world_notes, f)

    # Pitch contour: frame-level F0 in MIDI (null for unvoiced)
    with np.errstate(divide='ignore', invalid='ignore'):
        midi_all = np.where(
            f0 >= 1.0,
            np.round(12.0 * np.log2(f0 / 440.0) + 69.0, 2),
            np.nan,
        )
    pitch_contour = [None if np.isnan(v) else float(v) for v in midi_all]

    with open(tmp_dir / "pitch_contour.json", 'w') as f:
        json.dump({"frame_duration": frame_dur, "contour": pitch_contour}, f)

    # Amplitude envelope (RMS at ~100fps)
    env_hop = sr // 100
    n_env_frames = (len(vocals_audio) + env_hop - 1) // env_hop
    env_rms = _compute_frame_rms(vocals_audio, env_hop, n_env_frames)
    envelope = np.round(env_rms, 5).tolist()

    with open(tmp_dir / "amplitude.json", 'w') as f:
        json.dump({"sr": sr, "hop": env_hop, "envelope": envelope}, f)

    on_progress("done", "Ready!", total_steps, total_steps)

    return {
        "key": key,
        "melody_count": len(world_notes),
        "duration": len(vocals_audio) / sr,
    }
