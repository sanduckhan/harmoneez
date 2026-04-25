"""Harmony generation using music theory (music21)."""

from .utils import (
    HarmonyNote,
    INTERVAL_DEGREES, INTERVAL_SAFE_RANGE, CHROMATIC_FALLBACK,
    MIN_NOTE_DURATION, CHROMATIC_HOLD_THRESHOLD,
    MAX_HARMONY_MIDI, MIN_HARMONY_MIDI,
    build_scale_pitch_classes, is_in_scale,
)


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
        if target_midi <= midi_pitch:
            target_midi += 12
        if target_midi > MAX_HARMONY_MIDI:
            target_midi -= 12
    else:
        if target_midi >= midi_pitch:
            target_midi -= 12
        if target_midi < MIN_HARMONY_MIDI:
            target_midi += 12

    return target_midi


def get_drone_midi(midi_pitch: int, key_name: str, drone_type: str) -> int:
    """
    Get the nearest drone target MIDI note (root or 5th of the key)
    in the same octave range as the melody note.
    """
    parts = key_name.split()
    tonic = parts[0]
    from music21 import pitch as _p
    tonic_pc = _p.Pitch(tonic).midi % 12

    if drone_type == 'drone-5th':
        target_pc = (tonic_pc + 7) % 12
    else:
        target_pc = tonic_pc

    octave = midi_pitch // 12
    target_midi = octave * 12 + target_pc
    candidates = [target_midi - 12, target_midi, target_midi + 12]
    target_midi = min(candidates, key=lambda m: abs(m - midi_pitch))

    if target_midi > MAX_HARMONY_MIDI:
        target_midi -= 12
    elif target_midi < MIN_HARMONY_MIDI:
        target_midi += 12

    return target_midi


def _merge_continuous(notes: list[HarmonyNote], max_gap: float = 0.15) -> list[HarmonyNote]:
    """
    Merge consecutive harmony notes that target the same pitch into a single
    sustained note when the gap between them is small. Backing vocals hold
    steadier when the lead fragments into multiple short notes around one pitch.
    """
    if len(notes) < 2:
        return notes
    merged = [notes[0]]
    for hn in notes[1:]:
        prev = merged[-1]
        if hn.harmony_midi == prev.harmony_midi and (hn.start_time - prev.end_time) <= max_gap:
            merged[-1] = HarmonyNote(
                start_time=prev.start_time,
                end_time=max(prev.end_time, hn.end_time),
                original_midi=prev.original_midi,
                harmony_midi=prev.harmony_midi,
                semitone_shift=prev.semitone_shift,
            )
        else:
            merged.append(hn)
    return merged


def generate_harmony(
    melody_notes: list[tuple[float, float, int, float]],
    key_name: str,
    interval_type: str = '3rd-above',
) -> list[HarmonyNote]:
    """
    Generate a diatonic harmony for each melody note at the specified interval.
    """
    degrees = INTERVAL_DEGREES[interval_type]
    scale_pcs = build_scale_pitch_classes(key_name)
    is_major = "major" in key_name.lower()
    going_up = degrees is None or degrees > 0

    harmony_notes = []
    prev_harmony_midi = None

    for start, end, midi_pitch, velocity in melody_notes:
        duration = end - start

        if interval_type == 'unison':
            harmony_midi = midi_pitch

        elif interval_type in ('drone-root', 'drone-5th'):
            harmony_midi = get_drone_midi(midi_pitch, key_name, interval_type)

        elif interval_type == 'octave':
            harmony_midi = midi_pitch + 12
            if harmony_midi > MAX_HARMONY_MIDI:
                harmony_midi -= 12
            prev_harmony_midi = harmony_midi

        elif duration < MIN_NOTE_DURATION and prev_harmony_midi is not None:
            harmony_midi = prev_harmony_midi

        elif not is_in_scale(midi_pitch, scale_pcs) and duration < CHROMATIC_HOLD_THRESHOLD and prev_harmony_midi is not None:
            harmony_midi = prev_harmony_midi

        elif not is_in_scale(midi_pitch, scale_pcs):
            major_shift, minor_shift = CHROMATIC_FALLBACK[interval_type]
            fixed_shift = major_shift if is_major else minor_shift
            harmony_midi = midi_pitch + fixed_shift
            if harmony_midi > MAX_HARMONY_MIDI:
                harmony_midi -= 12
            elif harmony_midi < MIN_HARMONY_MIDI:
                harmony_midi += 12
            prev_harmony_midi = harmony_midi

        else:
            ideal = diatonic_interval(midi_pitch, scale_pcs, degrees)

            # Voice leading: prefer holding the previous harmony pitch when it's
            # still close to the ideal target AND forms a consonant interval
            # with the current melody note. This keeps backing vocals on common
            # tones instead of mechanically jumping with every melody move.
            if (
                prev_harmony_midi is not None
                and abs(prev_harmony_midi - ideal) <= 2
                and is_in_scale(prev_harmony_midi, scale_pcs)
                and 3 <= abs(prev_harmony_midi - midi_pitch) <= 12
            ):
                harmony_midi = prev_harmony_midi
            else:
                harmony_midi = ideal

            shift = harmony_midi - midi_pitch
            safe_min, safe_max = INTERVAL_SAFE_RANGE[interval_type]
            if shift < safe_min or shift > safe_max:
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

    return _merge_continuous(harmony_notes)
