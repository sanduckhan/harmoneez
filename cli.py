#!/usr/bin/env python3
"""
Harmoneez CLI — Vocal harmony generator for rock bands.

Usage:
    python cli.py song.wav
    python cli.py song.wav --key Ebm --interval 3rd-above
    python cli.py song.wav --key Ebm --start 1:49 --end 2:07
    python cli.py song.wav --key Ebm --start 1:49 --end 2:07 --interval all
"""

import argparse
import sys
import time
from pathlib import Path

from harmoneez.key_detection import confirm_key, detect_key, parse_key_string
from harmoneez.pipeline import run_pipeline
from harmoneez.separation import separate_vocals
from harmoneez.utils import (
    DEFAULT_HARMONY_VOLUME, INTERVAL_TYPES, SUPPORTED_EXTENSIONS,
    check_system_deps, parse_time,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog='harmonize',
        description='Generate diatonic vocal harmonies from a song recording.',
    )
    parser.add_argument('input_file', type=str, help='Path to the input audio file (WAV or MP3)')
    parser.add_argument('--key', type=str, default=None,
        help='Override detected key (e.g. "Gmajor", "Am", "Eb minor"). Skips the interactive prompt.')
    parser.add_argument('--harmony-volume', type=float, default=DEFAULT_HARMONY_VOLUME,
        help=f'Harmony volume in the mixed output, 0.0–1.0 (default: {DEFAULT_HARMONY_VOLUME})')
    parser.add_argument('--interval', type=str, default='all',
        help=f'Harmony interval type: {", ".join(INTERVAL_TYPES)}, or "all" (default: all)')
    parser.add_argument('--no-pitch-correct', action='store_true',
        help='Skip pitch correction of the vocal before harmony generation')
    parser.add_argument('--start', type=str, default=None,
        help='Start time for section selection, in seconds (109) or mm:ss (1:49)')
    parser.add_argument('--end', type=str, default=None,
        help='End time for section selection, in seconds (127) or mm:ss (2:07)')

    args = parser.parse_args()

    # Validate input file
    input_path = Path(args.input_file)
    if not input_path.is_file():
        parser.error(f"File not found: {args.input_file}")
    if input_path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        parser.error(f"Unsupported format '{input_path.suffix}'. Supported: {', '.join(SUPPORTED_EXTENSIONS)}")

    if not 0.0 <= args.harmony_volume <= 1.0:
        parser.error("--harmony-volume must be between 0.0 and 1.0")

    if args.key is not None:
        try:
            args.key = parse_key_string(args.key)
        except ValueError as e:
            parser.error(str(e))

    if args.interval != 'all' and args.interval not in INTERVAL_TYPES:
        parser.error(f"Unknown interval '{args.interval}'. Choose from: {', '.join(INTERVAL_TYPES)}, all")

    try:
        args.start_sec = parse_time(args.start) if args.start else None
        args.end_sec = parse_time(args.end) if args.end else None
    except ValueError as e:
        parser.error(str(e))

    if args.start_sec is not None and args.end_sec is not None:
        if args.start_sec >= args.end_sec:
            parser.error(f"--start ({args.start}) must be before --end ({args.end})")

    return args


def cli_progress(step: str, message: str, step_num: int, total_steps: int):
    """Print progress to stdout."""
    print(f"  [{step_num}/{total_steps}] {message}")


def main():
    args = parse_args()

    try:
        check_system_deps()
    except RuntimeError as e:
        print(f"Error: {e}")
        sys.exit(1)

    # If no --key provided, do interactive key detection before running pipeline
    resolved_key = args.key
    if resolved_key is None:
        import tempfile
        import numpy as np
        import soundfile as sf
        from harmoneez.key_detection import detect_key, detect_key_changes

        # Quick key detection on the uploaded file
        print("Detecting key...")
        tmp_dir = Path(tempfile.mkdtemp(prefix="harmoneez_key_"))
        vocals_audio, sr = separate_vocals(Path(args.input_file), tmp_dir)
        detected_key, confidence, top_3 = detect_key(vocals_audio, sr)

        has_key_change = detect_key_changes(vocals_audio, sr, detected_key)
        if has_key_change:
            print("  Warning: A potential key change was detected.")

        resolved_key = confirm_key(detected_key, confidence, top_3, None)
        print(f"  Using key: {resolved_key}")

        # Clean up the key detection temp dir
        import shutil
        shutil.rmtree(str(tmp_dir), ignore_errors=True)

    start_time = time.time()

    try:
        result = run_pipeline(
            input_path=args.input_file,
            key=resolved_key,
            start=args.start_sec,
            end=args.end_sec,
            pitch_correct=not args.no_pitch_correct,
            intervals=args.interval,
            harmony_volume=args.harmony_volume,
            on_progress=cli_progress,
        )

        elapsed = time.time() - start_time
        print(f"\nComplete! ({elapsed:.1f}s)")
        if result.get('corrected_path'):
            print(f"  Corrected vocal: {result['corrected_path']}")
        for f in result['files']:
            print(f"  [{f['interval']}]")
            print(f"    Harmony: {f['harmony_path']}")
            print(f"    Mixed:   {f['mixed_path']}")

    except KeyboardInterrupt:
        print("\nCancelled by user.")
        sys.exit(130)
    except Exception as e:
        print(f"\nError: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
