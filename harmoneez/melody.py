"""Melody extraction using Basic Pitch."""

from pathlib import Path

from .utils import VELOCITY_THRESHOLD


def extract_melody(vocals_path: Path) -> list[tuple[float, float, int, float]]:
    """
    Extract melody notes from the isolated vocal track using Basic Pitch.
    Returns list of (start_sec, end_sec, midi_pitch, velocity) sorted by start time.
    Raises ValueError if no notes are detected.
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
