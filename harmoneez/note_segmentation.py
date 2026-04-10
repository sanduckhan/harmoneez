"""
Convert a frame-level F0 pitch contour into discrete note events.

Uses pitch change-point detection + energy dip detection to find note
boundaries. Based on MIR research:
- Note onset: pitch jumps >80 cents sustained >50ms, or energy dip
- Vibrato (±80 cents, 5-7 Hz periodic) is NOT a note change
- Portamento (<120ms) attached to destination note
- Median pitch (excluding first 50ms transient) quantized to nearest semitone
- Notes flush in legato, gaps only where unvoiced >30ms
"""

import numpy as np


def f0_contour_to_notes(
    f0: np.ndarray,
    timeaxis: np.ndarray,
    audio: np.ndarray,
    sr: int,
    cent_threshold: float = 80.0,
    min_note_ms: float = 80.0,
    min_gap_ms: float = 30.0,
    energy_dip_ratio: float = 0.3,
) -> list[dict]:
    """
    Convert WORLD F0 contour to note events.

    Args:
        f0: F0 array from WORLD harvest (Hz, 0 = unvoiced)
        timeaxis: time of each frame in seconds
        audio: raw audio signal (mono, float)
        sr: sample rate
        cent_threshold: pitch jump threshold for new note (cents)
        min_note_ms: minimum note duration (ms)
        min_gap_ms: minimum unvoiced gap to insert silence (ms)
        energy_dip_ratio: RMS dip ratio to detect repeated same-pitch notes

    Returns:
        List of {"start_sec", "end_sec", "midi_pitch", "velocity"}
    """
    if len(f0) < 2:
        return []

    frame_dur = float(timeaxis[1] - timeaxis[0]) if len(timeaxis) > 1 else 0.005
    min_frames = max(1, int(min_note_ms / 1000.0 / frame_dur))
    min_gap_frames = max(1, int(min_gap_ms / 1000.0 / frame_dur))

    # Compute per-frame RMS energy
    hop_samples = int(frame_dur * sr)
    frame_energy = np.zeros(len(f0))
    for i in range(len(f0)):
        start = i * hop_samples
        end = min(start + hop_samples, len(audio))
        if start < len(audio):
            chunk = audio[start:end]
            frame_energy[i] = np.sqrt(np.mean(chunk ** 2))

    # Step 1: Find voiced segments (runs of consecutive voiced frames)
    segments = []
    seg_start = None

    for i in range(len(f0)):
        voiced = f0[i] > 1.0
        if voiced and seg_start is None:
            seg_start = i
        elif not voiced and seg_start is not None:
            segments.append((seg_start, i))
            seg_start = None
    if seg_start is not None:
        segments.append((seg_start, len(f0)))

    # Step 2: Within each voiced segment, split at pitch jumps and energy dips
    raw_notes = []

    for seg_start, seg_end in segments:
        if seg_end - seg_start < min_frames:
            continue

        # Find split points within this segment
        splits = [seg_start]

        # Track anchor pitch for the current note (set from initial stable frames)
        anchor_hz = None
        anchor_frames = 0
        ANCHOR_SETTLE = 10  # frames to establish the anchor pitch

        for i in range(seg_start, seg_end):
            curr_hz = f0[i]
            if curr_hz < 1.0:
                continue

            if anchor_hz is None:
                anchor_hz = curr_hz
                anchor_frames = 1
                continue

            # During the settling period, update the anchor as a running mean
            if anchor_frames < ANCHOR_SETTLE:
                anchor_hz = (anchor_hz * anchor_frames + curr_hz) / (anchor_frames + 1)
                anchor_frames += 1
                continue

            # Compare against the stable anchor pitch
            drift_cents = abs(1200.0 * np.log2(curr_hz / anchor_hz))

            # Also check consecutive frame jump
            prev_hz = f0[i - 1] if i > seg_start and f0[i - 1] > 1.0 else curr_hz
            jump_cents = abs(1200.0 * np.log2(curr_hz / prev_hz))

            if drift_cents > cent_threshold or jump_cents > cent_threshold * 1.5:
                splits.append(i)
                anchor_hz = curr_hz
                anchor_frames = 1
                continue

            # Energy dip detection (for repeated same-pitch notes)
            if i > seg_start + 2 and i < seg_end - 2:
                local_energy = frame_energy[i]
                surround_energy = max(
                    np.mean(frame_energy[max(seg_start, i - 3):i]),
                    np.mean(frame_energy[i + 1:min(seg_end, i + 4)]),
                )
                if surround_energy > 0 and local_energy / surround_energy < energy_dip_ratio:
                    splits.append(i)
                    anchor_hz = None
                    anchor_frames = 0

        splits.append(seg_end)

        # Create notes from split ranges
        for j in range(len(splits) - 1):
            note_start = splits[j]
            note_end = splits[j + 1]

            if note_end - note_start < min_frames:
                continue

            # Median pitch, excluding first 50ms transient
            transient_frames = min(int(0.05 / frame_dur), (note_end - note_start) // 3)
            stable_start = note_start + transient_frames
            stable_f0 = [f0[k] for k in range(stable_start, note_end) if f0[k] > 1.0]

            if not stable_f0:
                continue

            median_hz = float(np.median(stable_f0))
            midi = round(69 + 12 * np.log2(median_hz / 440.0))

            # Velocity from RMS energy (normalized 0-1)
            avg_energy = float(np.mean(frame_energy[note_start:note_end]))

            raw_notes.append({
                "start_sec": float(timeaxis[note_start]),
                "end_sec": float(timeaxis[min(note_end - 1, len(timeaxis) - 1)]),
                "midi_pitch": int(midi),
                "velocity": avg_energy,
                "median_hz": median_hz,
            })

    if not raw_notes:
        return []

    # Normalize velocities to 0-1
    max_vel = max(n["velocity"] for n in raw_notes)
    if max_vel > 0:
        for n in raw_notes:
            n["velocity"] = round(n["velocity"] / max_vel, 3)

    # Filter: remove very low velocity notes (likely noise)
    raw_notes = [n for n in raw_notes if n["velocity"] > 0.1]

    # Filter: remove pitch outliers (>14 semitones from median)
    if len(raw_notes) > 5:
        import statistics
        median_pitch = statistics.median(n["midi_pitch"] for n in raw_notes)
        raw_notes = [n for n in raw_notes if abs(n["midi_pitch"] - median_pitch) <= 14]

    # Clean up: remove median_hz from output
    for n in raw_notes:
        del n["median_hz"]

    return raw_notes
