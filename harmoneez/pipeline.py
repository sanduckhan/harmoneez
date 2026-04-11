"""Main pipeline orchestrator with progress callbacks."""

import tempfile
from pathlib import Path
from typing import Callable, Optional

import numpy as np
import soundfile as sf

from .separation import separate_vocals
from .key_detection import detect_key, detect_key_changes
from .pitch_correction import pitch_correct_vocals
from .melody import extract_melody
from .harmony import generate_harmony
from .renderer import analyze_world, render_harmony
from .mixer import mix_and_save
from .utils import INTERVAL_TYPES, SUPPORTED_EXTENSIONS

ProgressCallback = Callable[[str, str, int, int], None]


def _noop_progress(step: str, message: str, step_num: int, total_steps: int):
    pass


def run_pipeline(
    input_path: str | Path,
    key: str | None = None,
    start: float | None = None,
    end: float | None = None,
    pitch_correct: bool = True,
    intervals: str | list[str] = 'all',
    harmony_volume: float = 0.7,
    output_dir: Path | None = None,
    tmp_dir: Path | None = None,
    on_progress: ProgressCallback | None = None,
    skip_separation: bool = False,
) -> dict:
    """
    Run the full harmonize pipeline.

    Args:
        input_path: Path to WAV/MP3 file
        key: Override key (e.g. 'Eb minor'). None = auto-detect.
        start: Section start in seconds. None = beginning.
        end: Section end in seconds. None = end of song.
        pitch_correct: Whether to apply pitch correction.
        intervals: Interval type(s) to generate. 'all' or list of names.
        harmony_volume: 0.0–1.0, harmony level in mixed output.
        output_dir: Where to write output files. None = same dir as input.
        tmp_dir: Temp directory for intermediate files. None = auto-create.
        on_progress: Callback(step_name, message, step_num, total_steps).
        skip_separation: If True, treat input as already-isolated vocals (skip Demucs).

    Returns:
        dict with keys: key, confidence, candidates, has_key_change,
        corrected_path (or None), files [{interval, harmony_path, mixed_path}]
    """
    progress = on_progress or _noop_progress
    input_path = Path(input_path)
    if output_dir:
        output_dir = Path(output_dir)

    # Validate
    if not input_path.is_file():
        raise FileNotFoundError(f"File not found: {input_path}")
    if input_path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported format '{input_path.suffix}'. Supported: {', '.join(SUPPORTED_EXTENSIONS)}")

    # Resolve intervals
    if intervals == 'all':
        interval_list = INTERVAL_TYPES
    elif isinstance(intervals, str):
        interval_list = [intervals]
    else:
        interval_list = intervals

    # Create temp dir if not provided
    own_tmp = tmp_dir is None
    if own_tmp:
        tmp_dir = Path(tempfile.mkdtemp(prefix="harmoneez_"))

    total_steps = 4 + len(interval_list)  # separate + key + correct + melody + N intervals

    # Step 1: Isolate vocals + instrumental
    if skip_separation:
        progress("separating", "Loading vocal audio...", 1, total_steps)
        vocals_audio, sr = sf.read(str(input_path))
        if vocals_audio.ndim > 1:
            vocals_audio = vocals_audio.mean(axis=1)
        vocals_audio = vocals_audio.astype(np.float32)
        instrumental_audio = np.zeros_like(vocals_audio)
        sf.write(str(tmp_dir / "vocals.wav"), vocals_audio, sr)
    else:
        progress("separating", "Isolating vocals...", 1, total_steps)
        vocals_audio, instrumental_audio, sr = separate_vocals(input_path, tmp_dir)
    progress("separating", f"Vocal track: {len(vocals_audio) / sr:.1f}s at {sr}Hz", 1, total_steps)

    # Step 2: Detect key (skip if already provided)
    if key:
        confirmed_key = key
        confidence = 1.0
        candidates = [(key, 1.0)]
        has_key_change = False
        progress("detecting_key", f"Using provided key: {confirmed_key}", 2, total_steps)
    else:
        progress("detecting_key", "Detecting song key...", 2, total_steps)
        # Detect key on the original full mix (better harmonic context than isolated vocals)
        import librosa
        raw_audio, raw_sr = librosa.load(str(input_path), sr=None, mono=True)
        confirmed_key, confidence, candidates = detect_key(raw_audio.astype(np.float32), raw_sr)
        has_key_change = detect_key_changes(raw_audio.astype(np.float32), raw_sr, confirmed_key)
        if has_key_change:
            progress("detecting_key", f"Key change detected. Using {confirmed_key}", 2, total_steps)
        else:
            progress("detecting_key", f"Key: {confirmed_key} (confidence: {confidence:.2f})", 2, total_steps)

    # Crop to section
    vocals_path = tmp_dir / "vocals.wav"
    if start is not None or end is not None:
        start_sample = int(start * sr) if start else 0
        end_sample = int(end * sr) if end else len(vocals_audio)
        end_sample = min(end_sample, len(vocals_audio))
        vocals_audio = vocals_audio[start_sample:end_sample]
        instrumental_audio = instrumental_audio[start_sample:end_sample]
        sf.write(str(vocals_path), vocals_audio, sr)
        sf.write(str(tmp_dir / "instrumental.wav"), instrumental_audio, sr)

    # Save instrumental to output dir
    instrumental_path = (output_dir or input_path.parent) / f"{input_path.stem}_instrumental.wav"
    sf.write(str(instrumental_path), instrumental_audio, sr)

    # Step 3: Pitch correction
    corrected_path = None
    pitch_data_path = None
    if pitch_correct:
        progress("pitch_correcting", "Correcting vocal pitch...", 3, total_steps)
        raw_melody = extract_melody(vocals_path)
        vocals_audio, corrected_count, total_voiced, pitch_frames = pitch_correct_vocals(
            vocals_audio, sr, raw_melody, confirmed_key
        )
        corrected_path = (output_dir or input_path.parent) / f"{input_path.stem}_corrected.wav"
        sf.write(str(corrected_path), vocals_audio, sr)
        sf.write(str(vocals_path), vocals_audio, sr)

        # Save pitch data as JSON
        import json
        pitch_data_path = tmp_dir / "pitch_data.json"
        with open(pitch_data_path, 'w') as f:
            json.dump(pitch_frames, f)

        progress("pitch_correcting", f"Corrected {corrected_count}/{total_voiced} frames", 3, total_steps)

    # Step 4: Extract melody
    progress("extracting_melody", "Extracting melody notes...", 4, total_steps)
    melody_notes = extract_melody(vocals_path)
    progress("extracting_melody", f"Found {len(melody_notes)} notes", 4, total_steps)

    # Save melody data as JSON for the pitch guide
    melody_json = [
        {"start_sec": float(s), "end_sec": float(e), "midi_pitch": int(p), "velocity": round(float(v), 3)}
        for s, e, p, v in melody_notes
    ]
    with open(tmp_dir / "melody_data.json", 'w') as f:
        json.dump(melody_json, f)

    # WORLD analysis: run once, reuse for all intervals
    progress("analyzing", "Analyzing vocal audio...", 5, total_steps)
    world_data = analyze_world(vocals_audio, sr)

    # Steps 5+: Generate + render + mix for each interval
    output_files = []
    for i, interval_type in enumerate(interval_list):
        step_num = 5 + i
        progress("generating", f"Generating {interval_type}...", step_num, total_steps)

        harmony_notes = generate_harmony(melody_notes, confirmed_key, interval_type)
        harmony_audio = render_harmony(vocals_audio, sr, harmony_notes, world_analysis=world_data)
        harmony_path, mixed_path = mix_and_save(
            vocals_audio, harmony_audio, sr, input_path,
            harmony_volume, interval_type, output_dir,
        )
        output_files.append({
            'interval': interval_type,
            'harmony_path': str(harmony_path),
            'mixed_path': str(mixed_path),
        })

    progress("done", "Complete!", total_steps, total_steps)

    return {
        'key': confirmed_key,
        'confidence': confidence,
        'candidates': candidates,
        'has_key_change': has_key_change,
        'corrected_path': str(corrected_path) if corrected_path else None,
        'instrumental_path': str(instrumental_path),
        'pitch_data_path': str(pitch_data_path) if pitch_data_path else None,
        'files': output_files,
    }
