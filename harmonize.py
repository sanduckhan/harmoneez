#!/usr/bin/env python3
"""
Harmoneez — Vocal harmony generator for rock bands.
Generates diatonic vocal harmonies from a song recording.

Usage:
    python harmonize.py song.wav
    python harmonize.py song.wav --key Ebm --interval 3rd-above
    python harmonize.py song.wav --key Ebm --start 1:49 --end 2:07
    python harmonize.py song.wav --key Ebm --start 1:49 --end 2:07 --interval all
"""

import argparse
import re
import shutil
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

import essentia.standard as es
import librosa
import numpy as np
import soundfile as sf
from music21 import key as m21key, pitch as m21pitch

# Lazy imports for heavy libs (demucs, basic_pitch) — imported in their functions

# ── Constants ──────────────────────────────────────────────────────────────────

INTERVAL_TYPES = ['3rd-above', '3rd-below', '5th', '6th', 'octave']
INTERVAL_DEGREES = {
    '3rd-above': +2,
    '3rd-below': -2,
    '5th': +4,
    '6th': +5,
    'octave': None,  # special case: always +12 semitones
}

# Chromatic fallback: fixed semitone shift when note is outside the key
CHROMATIC_FALLBACK = {
    '3rd-above': (+4, +3),    # (major key, minor key)
    '3rd-below': (-3, -4),
    '5th': (+7, +7),          # perfect 5th in both
    '6th': (+9, +8),          # major 6th / minor 6th
    'octave': (+12, +12),
}

# "Safe" semitone ranges for each interval type — if the diatonic result
# falls outside this range, it's a diminished/augmented interval that
# sounds bad, so we snap to the nearest safe value.
INTERVAL_SAFE_RANGE = {
    '3rd-above': (3, 4),
    '3rd-below': (-4, -3),
    '5th': (7, 7),            # only perfect 5th sounds good
    '6th': (8, 9),
    'octave': (12, 12),
}

MIN_NOTE_DURATION = 0.1       # seconds — notes shorter than this are melismatic
CHROMATIC_HOLD_THRESHOLD = 0.2  # seconds — short chromatic notes get held
MAX_HARMONY_MIDI = 84         # C6 — ceiling for pitch-shifted harmony (not a singing range limit)
MIN_HARMONY_MIDI = 36         # C2 — floor for downward harmony intervals
PITCH_CORRECT_STRENGTH = 0.8  # 0.0 = no correction, 1.0 = full snap to scale
PITCH_CORRECT_THRESHOLD = 0.05  # semitones — skip correction below this
MIN_SEGMENT_SAMPLES = 512     # minimum samples for rubberband to process
CROSSFADE_MS = 15             # milliseconds crossfade between shifted segments
SEGMENT_PAD_MS = 50           # milliseconds of padding before/after each note segment
TIMING_OFFSET_MS = 15         # milliseconds delay on harmony (human is never perfectly in sync)
HARMONY_PAN = 0.3             # 0.0 = center, 1.0 = hard right; harmony panned slightly right
DETUNE_CENTS = 8              # micro-detuning in cents for chorus-like effect
DEFAULT_HARMONY_VOLUME = 0.7  # harmony level in the mix (0.0–1.0)
VELOCITY_THRESHOLD = 0.3      # minimum Basic Pitch velocity to keep a note

SUPPORTED_EXTENSIONS = {'.wav', '.mp3'}

KEY_PATTERN = re.compile(
    r'^([A-Ga-g][#b♯♭]?)\s*(major|minor|maj|min|m|M)?$', re.IGNORECASE
)


# ── Data Structures ───────────────────────────────────────────────────────────

@dataclass
class HarmonyNote:
    """A single note in the harmony sequence."""
    start_time: float       # seconds
    end_time: float         # seconds
    original_midi: int      # MIDI pitch of the melody note
    harmony_midi: int       # MIDI pitch of the harmony note
    semitone_shift: int     # harmony_midi - original_midi


# ── CLI ────────────────────────────────────────────────────────────────────────

def parse_time(time_str: str) -> float:
    """Parse '1:49' or '109' or '109.5' to seconds as float."""
    if ':' in time_str:
        parts = time_str.split(':')
        if len(parts) != 2:
            raise ValueError(f"Invalid time format: '{time_str}'. Use seconds (109) or mm:ss (1:49)")
        return float(parts[0]) * 60 + float(parts[1])
    return float(time_str)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog='harmonize',
        description='Generate diatonic vocal harmonies from a song recording.',
    )
    parser.add_argument(
        'input_file',
        type=str,
        help='Path to the input audio file (WAV or MP3)',
    )
    parser.add_argument(
        '--key',
        type=str,
        default=None,
        help='Override detected key (e.g. "Gmajor", "Am", "Eb minor"). '
             'Skips the interactive key confirmation prompt.',
    )
    parser.add_argument(
        '--harmony-volume',
        type=float,
        default=DEFAULT_HARMONY_VOLUME,
        help=f'Harmony volume in the mixed output, 0.0–1.0 (default: {DEFAULT_HARMONY_VOLUME})',
    )
    parser.add_argument(
        '--interval',
        type=str,
        default='all',
        help=f'Harmony interval type: {", ".join(INTERVAL_TYPES)}, or "all" (default: all)',
    )
    parser.add_argument(
        '--no-pitch-correct',
        action='store_true',
        help='Skip pitch correction of the vocal before harmony generation',
    )
    parser.add_argument(
        '--start',
        type=str,
        default=None,
        help='Start time for section selection, in seconds (109) or mm:ss (1:49)',
    )
    parser.add_argument(
        '--end',
        type=str,
        default=None,
        help='End time for section selection, in seconds (127) or mm:ss (2:07)',
    )
    args = parser.parse_args()

    # Validate input file
    input_path = Path(args.input_file)
    if not input_path.is_file():
        parser.error(f"File not found: {args.input_file}")
    if input_path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        parser.error(
            f"Unsupported format '{input_path.suffix}'. Supported: {', '.join(SUPPORTED_EXTENSIONS)}"
        )

    # Validate harmony volume
    if not 0.0 <= args.harmony_volume <= 1.0:
        parser.error("--harmony-volume must be between 0.0 and 1.0")

    # Validate --key if provided
    if args.key is not None:
        try:
            args.key = parse_key_string(args.key)
        except ValueError as e:
            parser.error(str(e))

    # Validate --interval
    if args.interval != 'all' and args.interval not in INTERVAL_TYPES:
        parser.error(f"Unknown interval '{args.interval}'. Choose from: {', '.join(INTERVAL_TYPES)}, all")

    # Parse --start and --end
    try:
        args.start_sec = parse_time(args.start) if args.start else None
        args.end_sec = parse_time(args.end) if args.end else None
    except ValueError as e:
        parser.error(str(e))

    if args.start_sec is not None and args.end_sec is not None:
        if args.start_sec >= args.end_sec:
            parser.error(f"--start ({args.start}) must be before --end ({args.end})")

    return args


def check_system_deps():
    """Check that required system tools are installed."""
    missing = []
    if shutil.which("rubberband") is None:
        missing.append("rubberband  (install with: brew install rubberband)")
    if shutil.which("ffmpeg") is None:
        missing.append("ffmpeg      (install with: brew install ffmpeg)")
    if missing:
        print("Error: Missing system dependencies:")
        for dep in missing:
            print(f"  - {dep}")
        sys.exit(1)


# ── Step 1: Vocal Isolation (Demucs) ──────────────────────────────────────────

def separate_vocals(input_path: Path, tmp_dir: Path) -> tuple[np.ndarray, int]:
    """
    Separate vocals from the input audio using Demucs v4.
    Returns (vocals_mono, sample_rate).
    """
    from demucs.apply import apply_model
    from demucs.audio import AudioFile
    from demucs.pretrained import get_model

    model = get_model("htdemucs")
    sr = model.samplerate  # 44100

    wav = AudioFile(str(input_path)).read(
        streams=0, samplerate=sr, channels=model.audio_channels
    )
    # apply_model expects [batch, channels, samples]
    sources = apply_model(model, wav.unsqueeze(0), device="cpu")

    # sources shape: [batch, num_sources, channels, samples]
    vocals_idx = model.sources.index("vocals")
    vocals_tensor = sources[0, vocals_idx]  # [channels, samples]

    # Convert to numpy, stereo → mono
    vocals_np = vocals_tensor.cpu().numpy()
    vocals_mono = np.mean(vocals_np, axis=0)

    # Save to tmp for Basic Pitch (which needs a file path)
    vocals_path = tmp_dir / "vocals.wav"
    sf.write(str(vocals_path), vocals_mono, sr)

    return vocals_mono, sr


# ── Step 2: Key Detection (librosa) ───────────────────────────────────────────

def detect_key(audio: np.ndarray, sr: int) -> tuple[str, float, list[tuple[str, float]]]:
    """
    Detect the musical key using Essentia's KeyExtractor with bgate profile.
    Returns (key_name, confidence, top_3_keys).
    """
    key_extractor = es.KeyExtractor(profileType='bgate', sampleRate=sr)
    key, scale, strength = key_extractor(audio.astype(np.float32))
    primary = f"{key} {scale}"

    # Run with alternate profiles for top-3 candidates
    candidates = [(primary, strength)]
    for profile in ('temperley', 'krumhansl'):
        ext = es.KeyExtractor(profileType=profile, sampleRate=sr)
        k, s, st = ext(audio.astype(np.float32))
        candidate = f"{k} {s}"
        if candidate != primary and candidate not in [c[0] for c in candidates]:
            candidates.append((candidate, st))
    candidates.sort(key=lambda x: x[1], reverse=True)

    return candidates[0][0], candidates[0][1], candidates[:3]


def detect_key_changes(audio: np.ndarray, sr: int, dominant_key: str) -> bool:
    """
    Check for potential key changes by analyzing 30-second segments.
    Returns True if a key change is suspected.
    """
    segment_len = 30 * sr  # 30 seconds in samples
    if len(audio) < segment_len * 2:
        return False  # song too short to meaningfully segment

    key_extractor = es.KeyExtractor(profileType='bgate', sampleRate=sr)
    num_segments = len(audio) // segment_len
    for i in range(num_segments):
        segment = audio[i * segment_len : (i + 1) * segment_len]
        key, scale, _ = key_extractor(segment.astype(np.float32))
        seg_key = f"{key} {scale}"
        if seg_key != dominant_key:
            return True

    return False


def parse_key_string(key_str: str) -> str:
    """
    Parse user-supplied key strings into canonical form for music21.
    'Gm' -> 'G minor', 'Gmajor' -> 'G major', 'Ab minor' -> 'Ab minor'
    Raises ValueError for unrecognized formats.
    """
    s = key_str.strip()

    # Handle concatenated forms like "Gmajor", "Aminor", "Abminor"
    s = re.sub(r'(?<=[A-Ga-g#b♯♭])(major|minor|maj|min)', r' \1', s, flags=re.IGNORECASE)

    match = KEY_PATTERN.match(s)
    if not match:
        raise ValueError(
            f"Unrecognized key format: '{key_str}'. "
            f"Examples: G, Gm, 'G major', 'Ab minor', 'F# major'"
        )

    root = match.group(1)
    quality = match.group(2)

    # Normalize root: capitalize first letter
    root = root[0].upper() + root[1:]
    # Normalize accidentals
    root = root.replace('♯', '#').replace('♭', 'b')

    # Normalize quality
    if quality is None:
        quality = "major"
    else:
        q = quality.lower()
        if q in ('m', 'min', 'minor'):
            quality = "minor"
        else:
            quality = "major"

    return f"{root} {quality}"


def confirm_key(
    detected_key: str,
    confidence: float,
    top_3: list[tuple[str, float]],
    cli_key_override: str | None,
) -> str:
    """
    If --key was provided, return it. Otherwise prompt for confirmation.
    """
    if cli_key_override is not None:
        return cli_key_override

    print(f"  Detected key: {detected_key} (confidence: {confidence:.2f})")
    print(f"  Top 3 candidates:")
    for key_name, corr in top_3:
        print(f"    - {key_name} ({corr:.2f})")

    user_input = input("  Press Enter to accept, or type a key (e.g. Gm, 'Ab major'): ").strip()

    if not user_input:
        return detected_key

    try:
        return parse_key_string(user_input)
    except ValueError as e:
        print(f"Error: {e}")
        sys.exit(1)


# ── Pitch Correction ──────────────────────────────────────────────────────────

def build_scale_hz(key_name: str) -> list[float]:
    """
    Return Hz values for all scale degrees across the vocal range (C2-C6).
    """
    scale_pcs = build_scale_pitch_classes(key_name)
    hz_targets = []
    for octave_midi in range(24, 85, 12):  # C2 (24) through C6 (84)
        for pc in scale_pcs:
            midi = octave_midi + pc
            if midi < MIN_HARMONY_MIDI or midi > MAX_HARMONY_MIDI:
                continue
            hz = 440.0 * (2.0 ** ((midi - 69) / 12.0))
            hz_targets.append(hz)
    return sorted(hz_targets)


def find_nearest_scale_hz(hz: float, scale_hz: list[float]) -> float:
    """Find the nearest Hz value in the scale target list."""
    best = scale_hz[0]
    best_dist = abs(1200 * np.log2(hz / best))
    for target in scale_hz[1:]:
        dist = abs(1200 * np.log2(hz / target))
        if dist < best_dist:
            best = target
            best_dist = dist
    return best


def pitch_correct_vocals(
    vocals_audio: np.ndarray,
    sr: int,
    note_events: list[tuple[float, float, int, float]],
    key_name: str,
    strength: float = PITCH_CORRECT_STRENGTH,
) -> np.ndarray:
    """
    Frame-by-frame pitch correction using WORLD vocoder.
    Decomposes audio into pitch (F0) + spectral envelope + aperiodicity,
    corrects F0 toward scale degrees, then resynthesizes.
    """
    import pyworld as pw

    scale_hz = build_scale_hz(key_name)
    audio_f64 = vocals_audio.astype(np.float64)

    # WORLD analysis: decompose into F0, spectral envelope, aperiodicity
    f0, timeaxis = pw.harvest(audio_f64, sr, f0_floor=65.0, f0_ceil=1000.0)
    sp = pw.cheaptrick(audio_f64, f0, timeaxis, sr)
    ap = pw.d4c(audio_f64, f0, timeaxis, sr)

    # Correct F0 frame-by-frame
    corrected_f0 = f0.copy()
    corrected_count = 0

    for i in range(len(f0)):
        if f0[i] < 1.0:
            # Unvoiced frame — skip
            continue

        actual_hz = f0[i]
        target_hz = find_nearest_scale_hz(actual_hz, scale_hz)

        # Deviation in cents
        deviation_cents = 1200.0 * np.log2(actual_hz / target_hz)

        if abs(deviation_cents) < PITCH_CORRECT_THRESHOLD * 100:
            continue

        # Apply partial correction
        correction_ratio = 2.0 ** ((-deviation_cents * strength) / 1200.0)
        corrected_f0[i] = actual_hz * correction_ratio
        corrected_count += 1

    # Resynthesize with corrected F0
    output = pw.synthesize(corrected_f0, sp, ap, sr)

    # Match original length (WORLD may produce slightly different length)
    if len(output) > len(vocals_audio):
        output = output[:len(vocals_audio)]
    elif len(output) < len(vocals_audio):
        output = np.pad(output, (0, len(vocals_audio) - len(output)))

    total_voiced = np.sum(f0 > 1.0)
    print(f"  Corrected {corrected_count}/{total_voiced} voiced frames (strength: {strength:.0%})")
    return output.astype(np.float32)


# ── Step 3: Melody Extraction (Basic Pitch) ───────────────────────────────────

def extract_melody(vocals_path: Path) -> list[tuple[float, float, int, float]]:
    """
    Extract melody notes from the isolated vocal track using Basic Pitch.
    Returns list of (start_sec, end_sec, midi_pitch, velocity) sorted by start time.
    """
    from basic_pitch.inference import predict

    model_output, midi_data, note_events = predict(str(vocals_path))

    notes = []
    for event in note_events:
        start, end, midi_pitch, velocity = event[0], event[1], event[2], event[3]
        if velocity < VELOCITY_THRESHOLD:
            continue
        notes.append((start, end, int(midi_pitch), velocity))

    notes.sort(key=lambda n: n[0])
    notes = reduce_to_monophonic(notes)

    if not notes:
        print("Error: No melody notes detected in the vocal track.")
        sys.exit(1)

    return notes


def reduce_to_monophonic(
    notes: list[tuple[float, float, int, float]],
) -> list[tuple[float, float, int, float]]:
    """
    Reduce polyphonic note list to monophonic by keeping the strongest
    note when notes overlap.
    """
    if not notes:
        return notes

    result = [notes[0]]
    for note in notes[1:]:
        prev = result[-1]
        if note[0] < prev[1]:
            # Overlapping — keep the one with higher velocity
            if note[3] > prev[3]:
                result[-1] = note
        else:
            result.append(note)

    return result


# ── Step 4: Harmony Generation (music21) ──────────────────────────────────────

def build_scale_pitch_classes(key_name: str) -> list[int]:
    """
    Return the 7 pitch classes (as MIDI mod 12) of the key's scale, in ascending order.
    Uses natural minor (aeolian) for minor keys — standard for rock.
    """
    # music21.Key expects Key('G', 'major') or Key('g') for minor
    parts = key_name.split()
    tonic = parts[0]
    mode = parts[1] if len(parts) > 1 else "major"
    k = m21key.Key(tonic, mode)
    sc = k.getScale()
    pitches = sc.getPitches(m21pitch.Pitch(midi=60), m21pitch.Pitch(midi=72))

    pcs = []
    seen = set()
    for p in pitches:
        pc = p.midi % 12
        if pc not in seen:
            pcs.append(pc)
            seen.add(pc)

    return pcs[:7]


def is_in_scale(midi_pitch: int, scale_pcs: list[int]) -> bool:
    """Check if a MIDI pitch's pitch class is in the scale."""
    return (midi_pitch % 12) in scale_pcs


def diatonic_interval(midi_pitch: int, scale_pcs: list[int], degrees: int) -> int:
    """
    Compute the MIDI pitch at a diatonic interval from the given pitch.
    degrees: +2 = 3rd above, -2 = 3rd below, +4 = 5th above, +5 = 6th above
    """
    pc = midi_pitch % 12
    octave = midi_pitch // 12

    deg_idx = scale_pcs.index(pc)

    target_idx = (deg_idx + degrees) % 7
    target_pc = scale_pcs[target_idx]

    target_midi = octave * 12 + target_pc

    if degrees > 0:
        # Interval above: result must be above original
        if target_midi <= midi_pitch:
            target_midi += 12
        if target_midi > MAX_HARMONY_MIDI:
            target_midi -= 12
    else:
        # Interval below: result must be below original
        if target_midi >= midi_pitch:
            target_midi -= 12
        if target_midi < MIN_HARMONY_MIDI:
            target_midi += 12

    return target_midi


def generate_harmony(
    melody_notes: list[tuple[float, float, int, float]],
    key_name: str,
    interval_type: str = '3rd-above',
) -> list[HarmonyNote]:
    """
    Generate a diatonic harmony for each melody note at the specified interval.
    Handles melismatic passages and chromatic notes.
    """
    degrees = INTERVAL_DEGREES[interval_type]
    scale_pcs = build_scale_pitch_classes(key_name)
    is_major = "major" in key_name.lower()
    going_up = degrees is None or degrees > 0

    harmony_notes = []
    prev_harmony_midi = None

    for start, end, midi_pitch, velocity in melody_notes:
        duration = end - start

        # Octave is a special case — always exactly +12 semitones
        if interval_type == 'octave':
            harmony_midi = midi_pitch + 12
            if harmony_midi > MAX_HARMONY_MIDI:
                harmony_midi -= 12
            prev_harmony_midi = harmony_midi

        # Priority 1: Melismatic — very short notes, sustain previous harmony
        elif duration < MIN_NOTE_DURATION and prev_harmony_midi is not None:
            harmony_midi = prev_harmony_midi

        # Priority 2: Chromatic + short — hold previous harmony
        elif not is_in_scale(midi_pitch, scale_pcs) and duration < CHROMATIC_HOLD_THRESHOLD and prev_harmony_midi is not None:
            harmony_midi = prev_harmony_midi

        # Priority 3: Chromatic + sustained — use interval-appropriate fixed shift
        elif not is_in_scale(midi_pitch, scale_pcs):
            major_shift, minor_shift = CHROMATIC_FALLBACK[interval_type]
            fixed_shift = major_shift if is_major else minor_shift
            harmony_midi = midi_pitch + fixed_shift
            if harmony_midi > MAX_HARMONY_MIDI:
                harmony_midi -= 12
            elif harmony_midi < MIN_HARMONY_MIDI:
                harmony_midi += 12
            prev_harmony_midi = harmony_midi

        # Priority 4: Diatonic — compute interval via scale degree arithmetic
        else:
            harmony_midi = diatonic_interval(midi_pitch, scale_pcs, degrees)

            # Correct diminished/augmented intervals that sound bad
            # (e.g. diminished 5th = tritone from 2nd degree of minor scale)
            shift = harmony_midi - midi_pitch
            safe_min, safe_max = INTERVAL_SAFE_RANGE[interval_type]
            if shift < safe_min or shift > safe_max:
                # Snap to nearest safe interval
                if abs(shift - safe_min) <= abs(shift - safe_max):
                    harmony_midi = midi_pitch + safe_min
                else:
                    harmony_midi = midi_pitch + safe_max

            prev_harmony_midi = harmony_midi

        semitone_shift = harmony_midi - midi_pitch

        harmony_notes.append(HarmonyNote(
            start_time=start,
            end_time=end,
            original_midi=midi_pitch,
            harmony_midi=harmony_midi,
            semitone_shift=semitone_shift,
        ))

    return harmony_notes


# ── Step 5: Audio Rendering (WORLD vocoder) ───────────────────────────────────

def render_harmony(
    vocals_audio: np.ndarray,
    sr: int,
    harmony_notes: list[HarmonyNote],
) -> np.ndarray:
    """
    Pitch-shift the vocal track using WORLD vocoder for formant-preserving rendering.
    Analyzes the full track once, then builds a per-frame F0 target from harmony notes.
    Returns numpy array of the same length as vocals_audio.
    """
    import pyworld as pw

    audio_f64 = vocals_audio.astype(np.float64)

    # WORLD analysis — run once on the full vocal track
    f0, timeaxis = pw.harvest(audio_f64, sr, f0_floor=65.0, f0_ceil=1000.0)
    sp = pw.cheaptrick(audio_f64, f0, timeaxis, sr)
    ap = pw.d4c(audio_f64, f0, timeaxis, sr)

    # Build a shifted F0 contour: only shift frames that fall within a harmony note
    f0_shifted = np.zeros_like(f0)  # silence by default (unvoiced)

    for hn in harmony_notes:
        shift_ratio = 2.0 ** (hn.semitone_shift / 12.0)
        pad_sec = SEGMENT_PAD_MS / 1000.0

        for i in range(len(timeaxis)):
            t = timeaxis[i]
            if t < hn.start_time - pad_sec or t > hn.end_time + pad_sec:
                continue
            if f0[i] < 1.0:
                continue  # unvoiced frame
            # Only set if not already set by a previous note (first note wins)
            if f0_shifted[i] < 1.0:
                f0_shifted[i] = f0[i] * shift_ratio

    # Synthesize with shifted F0 but original spectral envelope (formants preserved)
    raw_output = pw.synthesize(f0_shifted, sp, ap, sr)

    # Match original length
    if len(raw_output) > len(vocals_audio):
        raw_output = raw_output[:len(vocals_audio)]
    elif len(raw_output) < len(vocals_audio):
        raw_output = np.pad(raw_output, (0, len(vocals_audio) - len(raw_output)))

    # Gate: only keep WORLD output during note segments, silence elsewhere.
    # This removes wind/noise artifacts between notes.
    output = np.zeros_like(vocals_audio)
    crossfade_samples = int(CROSSFADE_MS / 1000.0 * sr)
    pad_samples = int(SEGMENT_PAD_MS / 1000.0 * sr)

    for hn in harmony_notes:
        start_sample = max(0, int(hn.start_time * sr) - pad_samples)
        end_sample = min(len(output), int(hn.end_time * sr) + pad_samples)
        seg_len = end_sample - start_sample
        if seg_len < MIN_SEGMENT_SAMPLES:
            continue

        segment = raw_output[start_sample:end_sample].copy()

        # Crossfade at boundaries
        cf = min(crossfade_samples, seg_len // 2)
        if cf > 0:
            segment[:cf] *= np.linspace(0, 1, cf)
            segment[seg_len - cf:seg_len] *= np.linspace(1, 0, cf)

        output[start_sample:end_sample] = segment

    return output.astype(np.float32)


# ── Step 6: Mix, Save, Cleanup ────────────────────────────────────────────────

def humanize_harmony(harmony_audio: np.ndarray, sr: int) -> np.ndarray:
    """
    Apply subtle humanization to make the harmony sound like a second singer:
    - Timing offset: shift the harmony slightly late
    - Micro-detuning: add a few cents of pitch variation (chorus effect)
    """
    import pyworld as pw

    # 1. Timing offset — pad the beginning, trim the end
    offset_samples = int(TIMING_OFFSET_MS / 1000.0 * sr)
    delayed = np.zeros_like(harmony_audio)
    delayed[offset_samples:] = harmony_audio[:-offset_samples]

    # 2. Micro-detuning via WORLD — shift F0 by a few cents
    audio_f64 = delayed.astype(np.float64)
    f0, t = pw.harvest(audio_f64, sr, f0_floor=65.0, f0_ceil=1500.0)
    sp = pw.cheaptrick(audio_f64, f0, t, sr)
    ap = pw.d4c(audio_f64, f0, t, sr)

    detune_ratio = 2.0 ** (DETUNE_CENTS / 1200.0)
    f0_detuned = f0 * detune_ratio

    detuned = pw.synthesize(f0_detuned, sp, ap, sr)

    # Match length
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
) -> tuple[Path, Path]:
    """
    Save harmony-only (mono) and mixed (stereo) WAV files.
    The mixed file pans the lead slightly left and harmony slightly right
    to create spatial separation, like two singers at different mic positions.
    """
    stem = input_path.stem
    output_dir = input_path.parent

    suffix = f"_{interval_label}" if interval_label else ""
    harmony_path = output_dir / f"{stem}{suffix}_harmony.wav"
    mixed_path = output_dir / f"{stem}{suffix}_mixed.wav"

    # Humanize the harmony (timing offset + micro-detuning)
    harmony_humanized = humanize_harmony(harmony_audio, sr)
    harmony_scaled = harmony_humanized * harmony_volume

    # Harmony-only output (mono)
    harmony_out = harmony_scaled.copy()
    max_harm = np.max(np.abs(harmony_out))
    if max_harm > 1.0:
        harmony_out /= max_harm
    sf.write(str(harmony_path), harmony_out, sr)

    # Mixed output (stereo with panning)
    # Pan: 0.0 = center, positive = right
    # Lead panned slightly left, harmony panned slightly right
    lead_left = vocals_audio * (0.5 + HARMONY_PAN * 0.5)   # louder on left
    lead_right = vocals_audio * (0.5 - HARMONY_PAN * 0.5)   # quieter on right
    harm_left = harmony_scaled * (0.5 - HARMONY_PAN * 0.5)  # quieter on left
    harm_right = harmony_scaled * (0.5 + HARMONY_PAN * 0.5)  # louder on right

    left = lead_left + harm_left
    right = lead_right + harm_right

    # Interleave to stereo [samples, 2]
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


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    args = parse_args()
    check_system_deps()

    input_path = Path(args.input_file)
    start_time = time.time()

    tmp_dir = Path(tempfile.mkdtemp(prefix="harmoneez_"))

    try:
        # Step 1: Isolate vocals (runs on full song)
        print("Step 1: Isolating vocals (this may take ~1 minute)...")
        vocals_audio, sr = separate_vocals(input_path, tmp_dir)
        print(f"  Done. Vocal track: {len(vocals_audio) / sr:.1f}s at {sr}Hz")

        # Step 2: Detect key (runs on full song)
        print("Step 2: Detecting song key...")
        detected_key, confidence, top_3 = detect_key(vocals_audio, sr)

        has_key_change = detect_key_changes(vocals_audio, sr, detected_key)
        if has_key_change:
            print("  Warning: A potential key change was detected in this song.")
            print("  The tool will use the dominant key throughout.")

        confirmed_key = confirm_key(detected_key, confidence, top_3, args.key)
        print(f"  Using key: {confirmed_key}")

        # Step 3: Crop to section (if --start / --end specified)
        vocals_path = tmp_dir / "vocals.wav"
        if args.start_sec is not None or args.end_sec is not None:
            song_duration = len(vocals_audio) / sr
            start_sample = int(args.start_sec * sr) if args.start_sec else 0
            end_sample = int(args.end_sec * sr) if args.end_sec else len(vocals_audio)

            if end_sample > len(vocals_audio):
                print(f"  Warning: --end exceeds song duration ({song_duration:.1f}s). Using end of song.")
                end_sample = len(vocals_audio)

            vocals_audio = vocals_audio[start_sample:end_sample]
            sf.write(str(vocals_path), vocals_audio, sr)

            start_fmt = args.start or "0:00"
            end_fmt = args.end or f"{song_duration:.0f}"
            print(f"  Cropped to section: {start_fmt} – {end_fmt} ({len(vocals_audio) / sr:.1f}s)")

        # Step 4: Pitch correction
        if not args.no_pitch_correct:
            print("Step 3: Correcting vocal pitch...")
            # Extract melody from raw vocal first (needed for correction targets)
            raw_melody = extract_melody(vocals_path)
            print(f"  Detected {len(raw_melody)} notes in raw vocal.")
            vocals_audio = pitch_correct_vocals(vocals_audio, sr, raw_melody, confirmed_key)
            # Save corrected vocal
            corrected_path = input_path.parent / f"{input_path.stem}_corrected.wav"
            sf.write(str(corrected_path), vocals_audio, sr)
            print(f"  Saved corrected vocal: {corrected_path}")
            # Re-save for Basic Pitch to re-extract from corrected audio
            sf.write(str(vocals_path), vocals_audio, sr)

        # Step 5: Extract melody (from corrected vocal if applicable)
        print("Step 4: Extracting melody notes...")
        melody_notes = extract_melody(vocals_path)
        print(f"  Done. Found {len(melody_notes)} notes.")

        # Step 5: Generate + render + save for each interval
        intervals = INTERVAL_TYPES if args.interval == 'all' else [args.interval]
        output_files = []

        for interval_type in intervals:
            print(f"Step 4: Generating {interval_type} harmony...")
            harmony_notes = generate_harmony(melody_notes, confirmed_key, interval_type)

            print(f"  Rendering audio...")
            harmony_audio = render_harmony(vocals_audio, sr, harmony_notes)

            print(f"  Saving files...")
            harmony_path, mixed_path = mix_and_save(
                vocals_audio, harmony_audio, sr, input_path,
                args.harmony_volume, interval_type,
            )
            output_files.append((interval_type, harmony_path, mixed_path))

        elapsed = time.time() - start_time
        print(f"\nComplete! ({elapsed:.1f}s)")
        for interval_type, harmony_path, mixed_path in output_files:
            print(f"  [{interval_type}]")
            print(f"    Harmony: {harmony_path}")
            print(f"    Mixed:   {mixed_path}")

    except KeyboardInterrupt:
        print("\nCancelled by user.")
        sys.exit(130)
    except Exception as e:
        print(f"\nError: {e}")
        sys.exit(1)
    finally:
        cleanup(tmp_dir)


if __name__ == "__main__":
    main()
