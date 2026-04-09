#!/usr/bin/env python3
"""
Harmoneez — Vocal harmony generator for rock bands.
Generates a diatonic third harmony from a song recording.

Usage:
    python harmonize.py song.wav
    python harmonize.py song.wav --key Gmajor
    python harmonize.py song.wav --harmony-volume 0.5
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
import numpy as np
import pyrubberband as pyrb
import soundfile as sf
from music21 import key as m21key, pitch as m21pitch

# Lazy imports for heavy libs (demucs, basic_pitch) — imported in their functions

# ── Constants ──────────────────────────────────────────────────────────────────

MIN_NOTE_DURATION = 0.1       # seconds — notes shorter than this are melismatic
CHROMATIC_HOLD_THRESHOLD = 0.2  # seconds — short chromatic notes get held
MAX_HARMONY_MIDI = 84         # C6 — ceiling for pitch-shifted harmony (not a singing range limit)
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

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog='harmonize',
        description='Generate a diatonic third vocal harmony from a song recording.',
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


def diatonic_third_above(midi_pitch: int, scale_pcs: list[int]) -> int:
    """
    Compute the MIDI pitch a diatonic third above the given pitch.
    Assumes the pitch is in the scale.
    """
    pc = midi_pitch % 12
    octave = midi_pitch // 12

    deg_idx = scale_pcs.index(pc)

    # Third above = +2 diatonic steps
    target_idx = (deg_idx + 2) % 7
    target_pc = scale_pcs[target_idx]

    # Reconstruct MIDI pitch in the right octave (must be above original)
    target_midi = octave * 12 + target_pc
    if target_midi <= midi_pitch:
        target_midi += 12

    # Vocal range clamping
    if target_midi > MAX_HARMONY_MIDI:
        target_midi -= 12

    return target_midi


def generate_harmony(
    melody_notes: list[tuple[float, float, int, float]],
    key_name: str,
) -> list[HarmonyNote]:
    """
    Generate a diatonic third harmony for each melody note.
    Handles melismatic passages and chromatic notes.
    """
    scale_pcs = build_scale_pitch_classes(key_name)
    is_major = "major" in key_name.lower()

    harmony_notes = []
    prev_harmony_midi = None

    for start, end, midi_pitch, velocity in melody_notes:
        duration = end - start

        # Priority 1: Melismatic — very short notes, sustain previous harmony
        if duration < MIN_NOTE_DURATION and prev_harmony_midi is not None:
            harmony_midi = prev_harmony_midi

        # Priority 2: Chromatic + short — hold previous harmony
        elif not is_in_scale(midi_pitch, scale_pcs) and duration < CHROMATIC_HOLD_THRESHOLD and prev_harmony_midi is not None:
            harmony_midi = prev_harmony_midi

        # Priority 3: Chromatic + sustained — fixed interval
        elif not is_in_scale(midi_pitch, scale_pcs):
            fixed_shift = 4 if is_major else 3  # major third or minor third
            harmony_midi = midi_pitch + fixed_shift
            if harmony_midi > MAX_HARMONY_MIDI:
                harmony_midi -= 12
            prev_harmony_midi = harmony_midi

        # Priority 4: Diatonic — compute third above via scale degree arithmetic
        else:
            harmony_midi = diatonic_third_above(midi_pitch, scale_pcs)
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


# ── Step 5: Audio Rendering (pyrubberband) ────────────────────────────────────

def render_harmony(
    vocals_audio: np.ndarray,
    sr: int,
    harmony_notes: list[HarmonyNote],
) -> np.ndarray:
    """
    Pitch-shift segments of the vocal track to create the harmony audio.
    Returns numpy array of the same length as vocals_audio.
    """
    output = np.zeros_like(vocals_audio)
    crossfade_samples = int(CROSSFADE_MS / 1000.0 * sr)
    pad_samples = int(SEGMENT_PAD_MS / 1000.0 * sr)

    for hn in harmony_notes:
        # Add padding around the note to capture natural attack/release
        start_sample = max(0, int(hn.start_time * sr) - pad_samples)
        end_sample = min(len(vocals_audio), int(hn.end_time * sr) + pad_samples)

        if end_sample - start_sample < MIN_SEGMENT_SAMPLES:
            continue

        segment = vocals_audio[start_sample:end_sample]

        if hn.semitone_shift == 0:
            output[start_sample:end_sample] = segment
            continue

        # Use rubberband with formant preservation for more natural vocal sound
        shifted = pyrb.pitch_shift(
            segment, sr, n_steps=hn.semitone_shift,
            rbargs={"--formant": ""}
        )

        # Handle length mismatch (rubberband may return slightly different length)
        actual_len = min(len(shifted), end_sample - start_sample)

        # Apply crossfades at both ends to avoid clicks
        cf = min(crossfade_samples, actual_len // 2)
        if cf > 0:
            shifted[:cf] *= np.linspace(0, 1, cf)
            shifted[actual_len - cf:actual_len] *= np.linspace(1, 0, cf)

        output[start_sample:start_sample + actual_len] = shifted[:actual_len]

    return output


# ── Step 6: Mix, Save, Cleanup ────────────────────────────────────────────────

def humanize_harmony(harmony_audio: np.ndarray, sr: int) -> np.ndarray:
    """
    Apply subtle humanization to make the harmony sound like a second singer:
    - Timing offset: shift the harmony slightly late
    - Micro-detuning: add a few cents of pitch variation (chorus effect)
    """
    # 1. Timing offset — pad the beginning, trim the end
    offset_samples = int(TIMING_OFFSET_MS / 1000.0 * sr)
    delayed = np.zeros_like(harmony_audio)
    delayed[offset_samples:] = harmony_audio[:-offset_samples]

    # 2. Micro-detuning — pitch shift by a few cents for chorus-like width
    #    DETUNE_CENTS cents = DETUNE_CENTS/100 semitones
    detuned = pyrb.pitch_shift(
        delayed, sr, n_steps=DETUNE_CENTS / 100.0,
        rbargs={"--formant": ""}
    )

    # Match length (rubberband may slightly change it)
    if len(detuned) > len(harmony_audio):
        detuned = detuned[:len(harmony_audio)]
    elif len(detuned) < len(harmony_audio):
        detuned = np.pad(detuned, (0, len(harmony_audio) - len(detuned)))

    return detuned


def mix_and_save(
    vocals_audio: np.ndarray,
    harmony_audio: np.ndarray,
    sr: int,
    input_path: Path,
    harmony_volume: float,
) -> tuple[Path, Path]:
    """
    Save harmony-only (mono) and mixed (stereo) WAV files.
    The mixed file pans the lead slightly left and harmony slightly right
    to create spatial separation, like two singers at different mic positions.
    """
    stem = input_path.stem
    output_dir = input_path.parent

    harmony_path = output_dir / f"{stem}_harmony.wav"
    mixed_path = output_dir / f"{stem}_mixed.wav"

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
        # Step 1: Isolate vocals
        print("Step 1/6: Isolating vocals (this may take ~1 minute)...")
        vocals_audio, sr = separate_vocals(input_path, tmp_dir)
        print(f"  Done. Vocal track: {len(vocals_audio) / sr:.1f}s at {sr}Hz")

        # Step 2: Detect key
        print("Step 2/6: Detecting song key...")
        detected_key, confidence, top_3 = detect_key(vocals_audio, sr)

        has_key_change = detect_key_changes(vocals_audio, sr, detected_key)
        if has_key_change:
            print("  Warning: A potential key change was detected in this song.")
            print("  The tool will use the dominant key throughout.")

        confirmed_key = confirm_key(detected_key, confidence, top_3, args.key)
        print(f"  Using key: {confirmed_key}")

        # Step 3: Extract melody
        print("Step 3/6: Extracting melody notes...")
        vocals_path = tmp_dir / "vocals.wav"
        melody_notes = extract_melody(vocals_path)
        print(f"  Done. Found {len(melody_notes)} notes.")

        # Step 4: Generate harmony
        print("Step 4/6: Generating diatonic third harmony...")
        harmony_notes = generate_harmony(melody_notes, confirmed_key)
        print(f"  Done. Generated {len(harmony_notes)} harmony notes.")

        # Step 5: Render harmony audio
        print("Step 5/6: Rendering harmony audio (pitch-shifting segments)...")
        harmony_audio = render_harmony(vocals_audio, sr, harmony_notes)
        print("  Done.")

        # Step 6: Mix and save
        print("Step 6/6: Mixing and saving output files...")
        harmony_path, mixed_path = mix_and_save(
            vocals_audio, harmony_audio, sr, input_path, args.harmony_volume
        )

        elapsed = time.time() - start_time
        print(f"\nComplete! ({elapsed:.1f}s)")
        print(f"  Harmony only: {harmony_path}")
        print(f"  Mixed output: {mixed_path}")

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
