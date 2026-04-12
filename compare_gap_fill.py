#!/usr/bin/env python3
"""
Compare harmony generation with and without F0 gap-filling.

Generates side-by-side WAV files from an existing corrected vocal recording
so you can A/B the difference.

Usage:
    python compare_gap_fill.py
"""

import json
import logging
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

logging.basicConfig(level=logging.INFO, format="%(name)s | %(message)s")
logger = logging.getLogger("compare")

# Use the longest recording: rec_8080f7 (31.4s, E major)
SESSION_DIR = Path.home() / ".harmoneez/sessions/d131cc86"
REC_DIR = SESSION_DIR / "recordings/rec_8080f7"
VOCAL_PATH = REC_DIR / "corrected.wav"
KEY = "E major"
INTERVALS = ["3rd-above", "3rd-below", "5th"]

OUTPUT_DIR = Path(__file__).parent / "comparison_output"


def main():
    if not VOCAL_PATH.exists():
        print(f"Vocal file not found: {VOCAL_PATH}")
        sys.exit(1)

    OUTPUT_DIR.mkdir(exist_ok=True)

    vocals_audio, sr = sf.read(str(VOCAL_PATH))
    if vocals_audio.ndim > 1:
        vocals_audio = vocals_audio.mean(axis=1)
    vocals_audio = vocals_audio.astype(np.float32)

    logger.info("Loaded vocal: %.1fs at %dHz", len(vocals_audio) / sr, sr)

    # Copy vocal to output for reference
    sf.write(str(OUTPUT_DIR / "00_vocal.wav"), vocals_audio, sr)

    # ── Extract melody (Basic Pitch) ────────────────────────────────────────
    from harmoneez.melody import (
        extract_melody, extend_notes_to_fill_gaps, f0_fill_gaps,
    )
    from harmoneez.renderer import analyze_world, render_harmony
    from harmoneez.harmony import generate_harmony
    from harmoneez.mixer import apply_timing_offset
    from harmoneez.utils import DEFAULT_HARMONY_VOLUME

    logger.info("Extracting melody with Basic Pitch...")
    # Write vocal to temp for Basic Pitch (it needs a file path)
    tmp_vocal = OUTPUT_DIR / "_tmp_vocal.wav"
    sf.write(str(tmp_vocal), vocals_audio, sr)
    melody_notes = extract_melody(tmp_vocal)
    logger.info("Basic Pitch: %d notes", len(melody_notes))

    # ── WORLD analysis (shared) ─────────────────────────────────────────────
    logger.info("Running WORLD analysis...")
    world_data = analyze_world(vocals_audio, sr)
    f0, timeaxis, sp, ap = world_data

    # ── Gap-filled melody ───────────────────────────────────────────────────
    melody_filled = extend_notes_to_fill_gaps(list(melody_notes))
    melody_filled = f0_fill_gaps(melody_filled, f0, timeaxis, KEY)
    logger.info("After gap-filling: %d notes (+%d)", len(melody_filled), len(melody_filled) - len(melody_notes))

    # ── Log coverage stats ──────────────────────────────────────────────────
    duration = len(vocals_audio) / sr
    def coverage(notes):
        return sum(e - s for s, e, _, _ in notes) / duration * 100

    logger.info("Coverage: Basic Pitch=%.1f%%, Gap-filled=%.1f%%", coverage(melody_notes), coverage(melody_filled))

    # Save note data for inspection
    def notes_to_json(notes):
        return [
            {"start": round(float(s), 3), "end": round(float(e), 3), "midi": int(p), "vel": round(float(v), 3)}
            for s, e, p, v in notes
        ]

    with open(OUTPUT_DIR / "melody_basic_pitch.json", "w") as f:
        json.dump(notes_to_json(melody_notes), f, indent=2)
    with open(OUTPUT_DIR / "melody_gap_filled.json", "w") as f:
        json.dump(notes_to_json(melody_filled), f, indent=2)

    # ── Generate harmonies for each interval ────────────────────────────────
    for interval in INTERVALS:
        logger.info("=== %s ===", interval)

        # Without gap-filling
        harmony_notes_orig = generate_harmony(melody_notes, KEY, interval)
        harmony_audio_orig = render_harmony(vocals_audio, sr, harmony_notes_orig, world_analysis=world_data)
        harmony_audio_orig = apply_timing_offset(harmony_audio_orig, sr)
        harmony_audio_orig *= DEFAULT_HARMONY_VOLUME

        # With gap-filling
        harmony_notes_filled = generate_harmony(melody_filled, KEY, interval)
        harmony_audio_filled = render_harmony(vocals_audio, sr, harmony_notes_filled, world_analysis=world_data)
        harmony_audio_filled = apply_timing_offset(harmony_audio_filled, sr)
        harmony_audio_filled *= DEFAULT_HARMONY_VOLUME

        # Save harmony-only stems
        safe_name = interval.replace("-", "_")
        sf.write(str(OUTPUT_DIR / f"{safe_name}_A_original.wav"), harmony_audio_orig, sr)
        sf.write(str(OUTPUT_DIR / f"{safe_name}_B_gapfilled.wav"), harmony_audio_filled, sr)

        # Save mixed (vocal + harmony, mono for easy comparison)
        mix_orig = vocals_audio + harmony_audio_orig
        mix_filled = vocals_audio + harmony_audio_filled

        # Normalize to prevent clipping
        for mix in [mix_orig, mix_filled]:
            peak = np.max(np.abs(mix))
            if peak > 0.95:
                mix *= 0.95 / peak

        sf.write(str(OUTPUT_DIR / f"{safe_name}_A_mix_original.wav"), mix_orig, sr)
        sf.write(str(OUTPUT_DIR / f"{safe_name}_B_mix_gapfilled.wav"), mix_filled, sr)

        logger.info(
            "  %s: %d → %d harmony notes",
            interval, len(harmony_notes_orig), len(harmony_notes_filled),
        )

    tmp_vocal.unlink(missing_ok=True)

    print(f"\n{'='*60}")
    print(f"Output written to: {OUTPUT_DIR}/")
    print(f"{'='*60}")
    print(f"Files:")
    print(f"  00_vocal.wav                  — original corrected vocal")
    print(f"  melody_basic_pitch.json       — note events (before)")
    print(f"  melody_gap_filled.json        — note events (after)")
    for interval in INTERVALS:
        safe = interval.replace("-", "_")
        print(f"  {safe}_A_original.wav     — harmony stem (before)")
        print(f"  {safe}_B_gapfilled.wav    — harmony stem (after)")
        print(f"  {safe}_A_mix_original.wav — vocal+harmony (before)")
        print(f"  {safe}_B_mix_gapfilled.wav— vocal+harmony (after)")
    print(f"\nCompare A vs B files to hear the difference.")


if __name__ == "__main__":
    main()
