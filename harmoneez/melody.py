"""Melody extraction using Basic Pitch."""

import logging
import statistics
from pathlib import Path
from typing import Optional

from .utils import VELOCITY_THRESHOLD

logger = logging.getLogger(__name__)

# Minimum note duration in seconds — shorter notes are likely percussion/noise
MIN_MELODY_DURATION = 0.08

# Notes more than this many semitones from the median pitch are likely artifacts
PITCH_OUTLIER_SEMITONES = 14

# Cached Basic Pitch model — the CoreML .mlpackage is loaded on first use and
# reused across calls so we don't re-init it on every extract_melody() call.
_MODEL: Optional["object"] = None


def _get_model():
    """Return the module-scope Basic Pitch model, loading it on first call."""
    global _MODEL
    if _MODEL is None:
        from basic_pitch import ICASSP_2022_MODEL_PATH
        from basic_pitch.inference import Model
        _MODEL = Model(ICASSP_2022_MODEL_PATH)
    return _MODEL


def extract_melody(vocals_path: Path) -> list[tuple[float, float, int, float]]:
    """
    Extract melody notes from the isolated vocal track using Basic Pitch.
    Returns list of (start_sec, end_sec, midi_pitch, velocity) sorted by start time.
    Raises ValueError if no notes are detected.
    """
    from basic_pitch.inference import predict

    try:
        model_output, midi_data, note_events = predict(
            str(vocals_path), model_or_model_path=_get_model()
        )
    except (ValueError, IndexError) as exc:
        # Basic Pitch can crash on very short or silent audio (e.g.
        # np.max on a zero-size onset array). Treat as "no notes."
        logger.error("Basic Pitch crashed: %s (file: %s)", exc, vocals_path)
        raise ValueError("No melody notes detected in the vocal track.")

    logger.info(
        "Basic Pitch raw output: %d note events from %s",
        len(note_events), vocals_path,
    )

    notes = []
    filtered_velocity = 0
    filtered_duration = 0
    for event in note_events:
        start, end, midi_pitch, velocity = event[0], event[1], event[2], event[3]
        if velocity < VELOCITY_THRESHOLD:
            filtered_velocity += 1
            continue
        duration = end - start
        if duration < MIN_MELODY_DURATION:
            filtered_duration += 1
            continue
        notes.append((start, end, int(midi_pitch), velocity))

    logger.info(
        "After filtering: %d notes kept, %d filtered by velocity (< %.2f), %d filtered by duration (< %.2fs)",
        len(notes), filtered_velocity, VELOCITY_THRESHOLD, filtered_duration, MIN_MELODY_DURATION,
    )

    # Remove pitch outliers — notes far from the median are likely artifacts
    if len(notes) > 5:
        pitches = [n[2] for n in notes]
        median_pitch = statistics.median(pitches)
        notes = [
            n for n in notes
            if abs(n[2] - median_pitch) <= PITCH_OUTLIER_SEMITONES
        ]

    notes.sort(key=lambda n: n[0])
    notes = reduce_to_monophonic(notes)

    if not notes:
        raise ValueError("No melody notes detected in the vocal track.")

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
            if note[3] > prev[3]:
                result[-1] = note
        else:
            result.append(note)

    return result
