#!/usr/bin/env python3
"""
Compare harmony generation: original vs gap-filled vs gap-filled+processed.

Generates side-by-side WAV files from an existing corrected vocal recording.

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
    sf.write(str(OUTPUT_DIR / "00_vocal.wav"), vocals_audio, sr)

    from harmoneez.melody import (
        extract_melody, extend_notes_to_fill_gaps, f0_fill_gaps,
    )
    from harmoneez.renderer import analyze_world, render_harmony
    from harmoneez.harmony import generate_harmony
    from harmoneez.mixer import apply_timing_offset, process_harmony
    from harmoneez.utils import DEFAULT_HARMONY_VOLUME

    # Extract melody
    logger.info("Extracting melody with Basic Pitch...")
    tmp_vocal = OUTPUT_DIR / "_tmp_vocal.wav"
    sf.write(str(tmp_vocal), vocals_audio, sr)
    melody_notes = extract_melody(tmp_vocal)
    logger.info("Basic Pitch: %d notes", len(melody_notes))

    # WORLD analysis
    logger.info("Running WORLD analysis...")
    world_data = analyze_world(vocals_audio, sr)
    f0, timeaxis, sp, ap = world_data

    # Gap-filled melody
    melody_filled = extend_notes_to_fill_gaps(list(melody_notes))
    melody_filled = f0_fill_gaps(melody_filled, f0, timeaxis, KEY)
    logger.info("After gap-filling: %d notes (+%d)", len(melody_filled), len(melody_filled) - len(melody_notes))

    # Coverage stats
    duration = len(vocals_audio) / sr
    def coverage(notes):
        return sum(e - s for s, e, _, _ in notes) / duration * 100
    logger.info("Coverage: Basic Pitch=%.1f%%, Gap-filled=%.1f%%", coverage(melody_notes), coverage(melody_filled))

    # Save note data
    def notes_to_json(notes):
        return [
            {"start": round(float(s), 3), "end": round(float(e), 3), "midi": int(p), "vel": round(float(v), 3)}
            for s, e, p, v in notes
        ]

    with open(OUTPUT_DIR / "melody_basic_pitch.json", "w") as f:
        json.dump(notes_to_json(melody_notes), f, indent=2)
    with open(OUTPUT_DIR / "melody_gap_filled.json", "w") as f:
        json.dump(notes_to_json(melody_filled), f, indent=2)

    # Generate for each interval — 3 versions:
    #   A = original (Basic Pitch only, no processing)
    #   B = gap-filled (no processing)
    #   C = gap-filled + EQ + reverb
    for interval in INTERVALS:
        logger.info("=== %s ===", interval)
        safe_name = interval.replace("-", "_")

        # A: Original
        hn_orig = generate_harmony(melody_notes, KEY, interval)
        ha_orig = render_harmony(vocals_audio, sr, hn_orig, world_analysis=world_data)
        ha_orig = apply_timing_offset(ha_orig, sr) * DEFAULT_HARMONY_VOLUME

        # B: Gap-filled, no processing
        hn_filled = generate_harmony(melody_filled, KEY, interval)
        ha_filled = render_harmony(vocals_audio, sr, hn_filled, world_analysis=world_data)
        ha_filled = apply_timing_offset(ha_filled, sr) * DEFAULT_HARMONY_VOLUME

        # C: Gap-filled + EQ + reverb
        hn_proc = generate_harmony(melody_filled, KEY, interval)
        ha_proc_raw = render_harmony(vocals_audio, sr, hn_proc, world_analysis=world_data)
        ha_proc_raw = apply_timing_offset(ha_proc_raw, sr)
        ha_proc = process_harmony(ha_proc_raw, sr) * DEFAULT_HARMONY_VOLUME

        # Save harmony-only stems
        sf.write(str(OUTPUT_DIR / f"{safe_name}_A_original.wav"), ha_orig, sr)
        sf.write(str(OUTPUT_DIR / f"{safe_name}_B_gapfilled.wav"), ha_filled, sr)
        sf.write(str(OUTPUT_DIR / f"{safe_name}_C_gapfilled_processed.wav"), ha_proc, sr)

        # Save mixes (mono for easy comparison)
        for label, harmony in [("A_original", ha_orig), ("B_gapfilled", ha_filled), ("C_processed", ha_proc)]:
            mix = vocals_audio + harmony
            peak = np.max(np.abs(mix))
            if peak > 0.95:
                mix *= 0.95 / peak
            sf.write(str(OUTPUT_DIR / f"{safe_name}_{label}_mix.wav"), mix, sr)

        logger.info("  %s: A=%d notes, B/C=%d notes", interval, len(hn_orig), len(hn_filled))

    tmp_vocal.unlink(missing_ok=True)

    print(f"\n{'='*60}")
    print(f"Output: {OUTPUT_DIR}/")
    print(f"{'='*60}")
    print("A = Basic Pitch only (before)")
    print("B = Gap-filled (no processing)")
    print("C = Gap-filled + EQ + reverb (full treatment)")
    print()
    for interval in INTERVALS:
        safe = interval.replace("-", "_")
        print(f"  {safe}_A_original_mix.wav")
        print(f"  {safe}_B_gapfilled_mix.wav")
        print(f"  {safe}_C_processed_mix.wav")
        print()


if __name__ == "__main__":
    main()
