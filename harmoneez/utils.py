"""Constants, data structures, and shared utilities."""

import re
import shutil
from dataclasses import dataclass

import numpy as np
from music21 import key as m21key, pitch as m21pitch

# ── Interval types and mappings ───────────────────────────────────────────────

INTERVAL_TYPES = ['3rd-above', '3rd-below', '5th', '6th', 'octave', 'unison', 'drone-root', 'drone-5th']

INTERVAL_DEGREES = {
    '3rd-above': +2,
    '3rd-below': -2,
    '5th': +4,
    '6th': +5,
    'octave': None,
    'unison': None,
    'drone-root': None,
    'drone-5th': None,
}

CHROMATIC_FALLBACK = {
    '3rd-above': (+4, +3),
    '3rd-below': (-3, -4),
    '5th': (+7, +7),
    '6th': (+9, +8),
    'octave': (+12, +12),
}

INTERVAL_SAFE_RANGE = {
    '3rd-above': (3, 4),
    '3rd-below': (-4, -3),
    '5th': (7, 7),
    '6th': (8, 9),
    'octave': (12, 12),
}

# ── Audio processing constants ────────────────────────────────────────────────

MIN_NOTE_DURATION = 0.1
CHROMATIC_HOLD_THRESHOLD = 0.2
MAX_HARMONY_MIDI = 84
MIN_HARMONY_MIDI = 36
PITCH_CORRECT_STRENGTH = 0.8
PITCH_CORRECT_THRESHOLD = 0.05
MIN_SEGMENT_SAMPLES = 512
CROSSFADE_MS = 15
SEGMENT_PAD_MS = 50
TIMING_OFFSET_MS = 15
HARMONY_PAN = 0.3
DETUNE_CENTS = 8
DEFAULT_HARMONY_VOLUME = 0.7
VELOCITY_THRESHOLD = 0.45

SUPPORTED_EXTENSIONS = {'.wav', '.mp3'}

KEY_PATTERN = re.compile(
    r'^([A-Ga-g][#b♯♭]?)\s*(major|minor|maj|min|m|M)?$', re.IGNORECASE
)


# ── Data Structures ───────────────────────────────────────────────────────────

@dataclass
class HarmonyNote:
    """A single note in the harmony sequence."""
    start_time: float
    end_time: float
    original_midi: int
    harmony_midi: int
    semitone_shift: int


# ── Shared utilities ──────────────────────────────────────────────────────────

def parse_time(time_str: str) -> float:
    """Parse '1:49' or '109' or '109.5' to seconds as float."""
    if ':' in time_str:
        parts = time_str.split(':')
        if len(parts) != 2:
            raise ValueError(f"Invalid time format: '{time_str}'. Use seconds (109) or mm:ss (1:49)")
        return float(parts[0]) * 60 + float(parts[1])
    return float(time_str)


def check_system_deps():
    """Check that required system tools are installed. Raises RuntimeError if missing."""
    missing = []
    if shutil.which("rubberband") is None:
        missing.append("rubberband  (install with: brew install rubberband)")
    if shutil.which("ffmpeg") is None:
        missing.append("ffmpeg      (install with: brew install ffmpeg)")
    if missing:
        raise RuntimeError(
            "Missing system dependencies:\n" + "\n".join(f"  - {dep}" for dep in missing)
        )


def build_scale_pitch_classes(key_name: str) -> list[int]:
    """
    Return the 7 pitch classes (as MIDI mod 12) of the key's scale, in ascending order.
    Uses natural minor (aeolian) for minor keys.
    """
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


NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
NAME_TO_PC = {'C':0,'C#':1,'Db':1,'D':2,'D#':3,'Eb':3,'E':4,'F':5,'F#':6,'Gb':6,'G':7,'G#':8,'Ab':8,'A':9,'A#':10,'Bb':10,'B':11}


def transpose_key_name(key_name: str, semitones: int) -> str:
    """Transpose a key name by N semitones. e.g. transpose_key_name('Eb minor', -1) → 'D minor'"""
    if semitones == 0:
        return key_name
    parts = key_name.split()
    root = parts[0]
    mode = parts[1] if len(parts) > 1 else "major"
    root_pc = NAME_TO_PC.get(root, 0)
    new_pc = (root_pc + semitones) % 12
    return f"{NOTE_NAMES[new_pc]} {mode}"
