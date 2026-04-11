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


def _noop_progress(step: str, message: str, step_num: int, total_steps: int):
    pass


def run_prepare(
    input_path: str | Path,
    tmp_dir: str | Path,
    transpose: int = 0,
    key: str = "",
    duration: float = 0,
    on_progress: Optional[ProgressCallback] = None,
) -> dict:
    """
    Separate vocals from instrumental, optionally transpose, extract melody + pitch contour + amplitude.

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
    total_steps = 5 if transpose != 0 else 2
    step = 0

    # Step 1: Separate vocals
    step += 1
    estimate = max(30, int(duration * 0.35))
    on_progress("separating", f"Isolating vocals... (~{estimate}s)", step, total_steps)
    vocals_audio, instrumental_audio, sr = separate_vocals(input_path, tmp_dir)

    # Steps 2-4: Pitch shift if transpose != 0
    if transpose != 0:
        # Step 2: Analyze vocal pitch (WORLD harvest + cheaptrick + d4c)
        step += 1
        on_progress("transposing", "Analyzing vocal pitch...", step, total_steps)
        audio_f64 = vocals_audio.astype(np.float64)
        f0_v, ta_v = pw.harvest(audio_f64, sr, f0_floor=65.0, f0_ceil=1000.0)
        sp_v = pw.cheaptrick(audio_f64, f0_v, ta_v, sr)
        ap_v = pw.d4c(audio_f64, f0_v, ta_v, sr)

        # Step 3: Transpose vocals (WORLD synthesis)
        step += 1
        on_progress("transposing", "Transposing vocals...", step, total_steps)
        f0_shifted = f0_v * (2.0 ** (transpose / 12.0))
        vocals_shifted = pw.synthesize(f0_shifted, sp_v, ap_v, sr)
        if len(vocals_shifted) > len(vocals_audio):
            vocals_shifted = vocals_shifted[:len(vocals_audio)]
        elif len(vocals_shifted) < len(vocals_audio):
            vocals_shifted = np.pad(vocals_shifted, (0, len(vocals_audio) - len(vocals_shifted)))
        vocals_audio = vocals_shifted.astype(np.float32)

        # Step 4: Transpose instrumental (librosa phase vocoder)
        step += 1
        on_progress("transposing", "Transposing instrumental...", step, total_steps)
        instrumental_audio = pitch_shift_librosa(instrumental_audio, sr, transpose)

        sf.write(str(tmp_dir / "vocals.wav"), vocals_audio, sr)
        sf.write(str(tmp_dir / "instrumental.wav"), instrumental_audio, sr)

    # Create full mix from stems
    full_mix = vocals_audio + instrumental_audio
    max_val = np.max(np.abs(full_mix))
    if max_val > 1.0:
        full_mix = full_mix / max_val
    sf.write(str(tmp_dir / "full_mix.wav"), full_mix, sr)

    # Final step: Extract melody via WORLD F0 contour
    step += 1
    on_progress("extracting_melody", "Extracting melody...", step, total_steps)

    audio_f64 = vocals_audio.astype(np.float64)
    f0, timeaxis = pw.harvest(audio_f64, sr, f0_floor=65.0, f0_ceil=1000.0)

    world_notes = f0_contour_to_notes(f0, timeaxis, vocals_audio, sr)

    with open(tmp_dir / "melody_data.json", 'w') as f:
        json.dump(world_notes, f)

    # Pitch contour: frame-level F0 in MIDI (null for unvoiced)
    pitch_contour = []
    for i in range(len(f0)):
        if f0[i] < 1.0:
            pitch_contour.append(None)
        else:
            midi = 12 * np.log2(f0[i] / 440.0) + 69
            pitch_contour.append(round(float(midi), 2))

    frame_duration = float(timeaxis[1] - timeaxis[0]) if len(timeaxis) > 1 else 0.005

    with open(tmp_dir / "pitch_contour.json", 'w') as f:
        json.dump({"frame_duration": frame_duration, "contour": pitch_contour}, f)

    # Amplitude envelope (RMS at ~100fps)
    hop = sr // 100
    envelope = []
    for i in range(0, len(vocals_audio), hop):
        chunk = vocals_audio[i:i + hop]
        rms = float(np.sqrt(np.mean(chunk ** 2)))
        envelope.append(round(rms, 5))
    with open(tmp_dir / "amplitude.json", 'w') as f:
        json.dump({"sr": sr, "hop": hop, "envelope": envelope}, f)

    on_progress("done", "Ready!", total_steps, total_steps)

    return {
        "key": key,
        "melody_count": len(world_notes),
        "duration": len(vocals_audio) / sr,
    }
