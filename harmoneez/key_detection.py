"""Key detection using Essentia KeyExtractor."""

import re

import essentia.standard as es
import numpy as np

from .utils import KEY_PATTERN


def detect_key(audio: np.ndarray, sr: int) -> tuple[str, float, list[tuple[str, float]]]:
    """
    Detect the musical key using Essentia's KeyExtractor with bgate profile.
    Returns (key_name, confidence, top_3_keys).
    """
    key_extractor = es.KeyExtractor(profileType='bgate', sampleRate=sr)
    key, scale, strength = key_extractor(audio.astype(np.float32))
    primary = f"{key} {scale}"

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
    segment_len = 30 * sr
    if len(audio) < segment_len * 2:
        return False

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
    s = re.sub(r'(?<=[A-Ga-g#b♯♭])(major|minor|maj|min)', r' \1', s, flags=re.IGNORECASE)

    match = KEY_PATTERN.match(s)
    if not match:
        raise ValueError(
            f"Unrecognized key format: '{key_str}'. "
            f"Examples: G, Gm, 'G major', 'Ab minor', 'F# major'"
        )

    root = match.group(1)
    quality = match.group(2)

    root = root[0].upper() + root[1:]
    root = root.replace('♯', '#').replace('♭', 'b')

    if quality is None:
        quality = "major"
    else:
        q = quality.lower()
        if q in ('m', 'min', 'minor'):
            quality = "minor"
        else:
            quality = "major"

    return f"{root} {quality}"
