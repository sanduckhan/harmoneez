"""Melody extraction using Basic Pitch, with F0-based gap filling."""

import logging
import statistics
from pathlib import Path
from typing import Optional

import numpy as np

from .utils import VELOCITY_THRESHOLD, build_scale_pitch_classes, is_in_scale

logger = logging.getLogger(__name__)

# Minimum note duration in seconds — shorter notes are likely percussion/noise
MIN_MELODY_DURATION = 0.08

# Notes more than this many semitones from the median pitch are likely artifacts
PITCH_OUTLIER_SEMITONES = 14

# Gap-filling constants
MAX_EXTEND_GAP_SEC = 0.25   # extend neighboring notes to cover gaps up to this size
MAX_F0_GAP_SEC = 2.0        # fill with F0 data for gaps up to this size
F0_MIN_NOTE_SEC = 0.06      # minimum duration for F0-derived notes

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
    notes = correct_octave_outliers(notes)

    if not notes:
        raise ValueError("No melody notes detected in the vocal track.")

    return notes


def correct_octave_outliers(
    notes: list[tuple[float, float, int, float]],
    window_sec: float = 4.0,
    max_dev_semitones: int = 7,
) -> list[tuple[float, float, int, float]]:
    """
    Snap notes that are more than ~7 semitones from their local-median pitch
    back into range by transposing in octaves. Basic Pitch occasionally flips
    a note an octave off; this pulls it back without dropping it.
    """
    if len(notes) < 5:
        return notes
    centers = [(s + e) / 2 for s, e, _, _ in notes]
    pitches = [p for _, _, p, _ in notes]
    out = []
    for i, (s, e, p, v) in enumerate(notes):
        c = centers[i]
        local = [
            pitches[j] for j in range(len(notes))
            if j != i and abs(centers[j] - c) <= window_sec / 2
        ]
        if not local:
            out.append((s, e, p, v))
            continue
        median = int(statistics.median(local))
        while p - median > max_dev_semitones:
            p -= 12
        while median - p > max_dev_semitones:
            p += 12
        out.append((s, e, p, v))
    return out


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


def extend_notes_to_fill_gaps(
    notes: list[tuple[float, float, int, float]],
    max_gap: float = MAX_EXTEND_GAP_SEC,
) -> list[tuple[float, float, int, float]]:
    """
    Extend neighboring notes to cover small gaps between them.
    For gaps < max_gap: if pitches are close (<=2 semitones), extend the
    previous note; otherwise split at the midpoint.
    """
    if len(notes) < 2:
        return notes

    result = list(notes)
    for i in range(len(result) - 1):
        prev_start, prev_end, prev_pitch, prev_vel = result[i]
        curr_start, curr_end, curr_pitch, curr_vel = result[i + 1]
        gap = curr_start - prev_end

        if 0 < gap <= max_gap:
            if abs(curr_pitch - prev_pitch) <= 2:
                # Close in pitch: extend previous note
                result[i] = (prev_start, curr_start, prev_pitch, prev_vel)
            else:
                # Different pitches: split at midpoint
                mid = prev_end + gap / 2
                result[i] = (prev_start, mid, prev_pitch, prev_vel)
                result[i + 1] = (mid, curr_end, curr_pitch, curr_vel)

    return result


def f0_fill_gaps(
    notes: list[tuple[float, float, int, float]],
    f0: np.ndarray,
    timeaxis: np.ndarray,
    key_name: str,
    max_gap: float = MAX_F0_GAP_SEC,
    min_note: float = F0_MIN_NOTE_SEC,
) -> list[tuple[float, float, int, float]]:
    """
    Fill gaps in the melody note list using WORLD's F0 contour.

    For each gap between consecutive notes (or before the first / after the
    last), check the F0 contour for voiced frames. Convert those to note
    events snapped to the song's key.
    """
    if len(f0) < 2 or len(timeaxis) < 2:
        return notes

    scale_pcs = build_scale_pitch_classes(key_name)
    frame_dur = float(timeaxis[1] - timeaxis[0])

    # Build list of gaps: (gap_start, gap_end)
    gaps = []
    sorted_notes = sorted(notes, key=lambda n: n[0])

    if sorted_notes:
        # Gap before first note
        if sorted_notes[0][0] > 0:
            gaps.append((0.0, sorted_notes[0][0]))
        # Gaps between notes
        for i in range(len(sorted_notes) - 1):
            gap_start = sorted_notes[i][1]
            gap_end = sorted_notes[i + 1][0]
            if gap_end - gap_start > 0.01:  # ignore tiny overlaps
                gaps.append((gap_start, gap_end))
        # Gap after last note
        last_time = float(timeaxis[-1])
        if sorted_notes[-1][1] < last_time:
            gaps.append((sorted_notes[-1][1], last_time))

    if not gaps:
        return notes

    filled = []
    for gap_start, gap_end in gaps:
        if gap_end - gap_start > max_gap:
            continue

        # Find F0 frames within this gap
        mask = (timeaxis >= gap_start) & (timeaxis < gap_end) & (f0 > 1.0)
        if not np.any(mask):
            continue

        indices = np.where(mask)[0]

        # Group consecutive voiced frames into note segments
        segments = []
        seg_start_idx = indices[0]
        for j in range(1, len(indices)):
            if indices[j] - indices[j - 1] > 2:  # allow 1-frame gap
                segments.append((seg_start_idx, indices[j - 1]))
                seg_start_idx = indices[j]
        segments.append((seg_start_idx, indices[-1]))

        for seg_start_idx, seg_end_idx in segments:
            seg_start_t = float(timeaxis[seg_start_idx])
            seg_end_t = float(timeaxis[min(seg_end_idx + 1, len(timeaxis) - 1)])

            if seg_end_t - seg_start_t < min_note:
                continue

            # Median F0 in this segment → MIDI
            seg_f0 = f0[seg_start_idx:seg_end_idx + 1]
            voiced_f0 = seg_f0[seg_f0 > 1.0]
            if len(voiced_f0) == 0:
                continue

            median_hz = float(np.median(voiced_f0))
            midi_raw = 69 + 12 * np.log2(median_hz / 440.0)
            midi = int(round(midi_raw))

            # Snap to nearest scale degree if close (within 1 semitone)
            if not is_in_scale(midi, scale_pcs):
                for offset in [1, -1]:
                    if is_in_scale(midi + offset, scale_pcs):
                        midi = midi + offset
                        break

            filled.append((seg_start_t, seg_end_t, midi, 0.35))

    if filled:
        logger.info("F0 gap-filling: added %d notes to cover melody gaps", len(filled))

    merged = list(notes) + filled
    merged.sort(key=lambda n: n[0])
    return merged
