"""
Generate the 3rd-above harmony for rec_091760 in several variants so the
different design choices we tried can be A/B'd back-to-back.

Output: comparison_output/<variant>.wav  (mono harmony stem only — no lead).
"""

from pathlib import Path
import numpy as np
import soundfile as sf

from harmoneez.melody import extract_melody
from harmoneez.harmony import (
    diatonic_interval, _merge_continuous,
)
from harmoneez.renderer import analyze_world, render_harmony
from harmoneez.utils import (
    HarmonyNote, INTERVAL_DEGREES, INTERVAL_SAFE_RANGE, CHROMATIC_FALLBACK,
    MIN_NOTE_DURATION, CHROMATIC_HOLD_THRESHOLD,
    MAX_HARMONY_MIDI, MIN_HARMONY_MIDI,
    INTERVAL_FORMANT_SHIFT, INTERVAL_DETUNE_CENTS, DETUNE_CENTS,
    build_scale_pitch_classes, is_in_scale,
)

REC = Path.home() / ".harmoneez/sessions/1a0ef33a/recordings/rec_091760"
KEY = "A minor"
INTERVAL = "3rd-above"
OUT = Path("/Users/manu/Documents/side-projects/harmoneez/comparison_output/rec_091760")
OUT.mkdir(parents=True, exist_ok=True)


# ── Three flavors of harmony-note generation ───────────────────────────────

def gen_naive(melody_notes):
    """Pure parallel 3rd. No voice leading, no chromatic-hold, no merging."""
    degrees = INTERVAL_DEGREES[INTERVAL]
    scale = build_scale_pitch_classes(KEY)
    notes = []
    for s, e, midi, _ in melody_notes:
        if is_in_scale(midi, scale):
            h = diatonic_interval(midi, scale, degrees)
        else:
            major_shift, minor_shift = CHROMATIC_FALLBACK[INTERVAL]
            h = midi + (major_shift if "major" in KEY.lower() else minor_shift)
            h = max(MIN_HARMONY_MIDI, min(MAX_HARMONY_MIDI, h))
        notes.append(HarmonyNote(s, e, midi, h, h - midi))
    return notes


def gen_voice_leading(melody_notes, with_safe_range_gate: bool):
    """
    Voice-leading (common-tone hold) version. with_safe_range_gate=False
    reproduces the old buggy behavior that emitted C#4 in A minor;
    with_safe_range_gate=True is the current fix.
    """
    degrees = INTERVAL_DEGREES[INTERVAL]
    scale = build_scale_pitch_classes(KEY)
    is_major = "major" in KEY.lower()
    safe_min, safe_max = INTERVAL_SAFE_RANGE[INTERVAL]
    notes = []
    prev = None
    for s, e, midi, _ in melody_notes:
        dur = e - s
        if dur < MIN_NOTE_DURATION and prev is not None:
            h = prev
        elif not is_in_scale(midi, scale) and dur < CHROMATIC_HOLD_THRESHOLD and prev is not None:
            h = prev
        elif not is_in_scale(midi, scale):
            major_shift, minor_shift = CHROMATIC_FALLBACK[INTERVAL]
            h = midi + (major_shift if is_major else minor_shift)
            h = max(MIN_HARMONY_MIDI, min(MAX_HARMONY_MIDI, h))
            prev = h
        else:
            ideal = diatonic_interval(midi, scale, degrees)
            prev_shift = (prev - midi) if prev is not None else None
            hold = (
                prev is not None
                and abs(prev - ideal) <= 2
                and is_in_scale(prev, scale)
                and (3 <= abs(prev - midi) <= 12)
            )
            if with_safe_range_gate and hold:
                hold = hold and (safe_min <= prev_shift <= safe_max)
            h = prev if hold else ideal

            shift = h - midi
            if shift < safe_min or shift > safe_max:
                if abs(shift - safe_min) <= abs(shift - safe_max):
                    h = midi + safe_min
                else:
                    h = midi + safe_max
                if with_safe_range_gate and not is_in_scale(h, scale):
                    h = ideal
            prev = h
        notes.append(HarmonyNote(s, e, midi, h, h - midi))
    return _merge_continuous(notes)


# ── Render variants ─────────────────────────────────────────────────────────

def main():
    vocal_path = REC / "vocal.wav"
    audio, sr = sf.read(str(vocal_path))
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    audio = audio.astype(np.float32)

    print(f"Loaded vocal: {len(audio)/sr:.1f}s @ {sr}Hz")

    print("Running WORLD analysis (one pass, reused across variants)...")
    world = analyze_world(audio, sr)

    print("Extracting melody (Basic Pitch + post-processing)...")
    melody = extract_melody(vocal_path)
    print(f"  {len(melody)} notes")

    formant = INTERVAL_FORMANT_SHIFT.get(INTERVAL, 1.0)
    detune = INTERVAL_DETUNE_CENTS.get(INTERVAL, DETUNE_CENTS)

    variants = [
        # name,                         harmony notes,                       render kwargs
        ("01_naive_parallel",
            gen_naive(melody),
            dict(formant_factor=1.0, detune_cents=DETUNE_CENTS, in_tune=False, vibrato_dampen=0.0)),
        ("02_voice_leading_BUGGY",
            gen_voice_leading(melody, with_safe_range_gate=False),
            dict(formant_factor=formant, detune_cents=detune, in_tune=False, vibrato_dampen=0.5)),
        ("03_voice_leading_FIXED",
            gen_voice_leading(melody, with_safe_range_gate=True),
            dict(formant_factor=formant, detune_cents=detune, in_tune=False, vibrato_dampen=0.5)),
        ("04_FIXED_in_tune",
            gen_voice_leading(melody, with_safe_range_gate=True),
            dict(formant_factor=formant, detune_cents=detune, in_tune=True, vibrato_dampen=0.5)),
        ("05_FIXED_no_vibrato_dampen",
            gen_voice_leading(melody, with_safe_range_gate=True),
            dict(formant_factor=formant, detune_cents=detune, in_tune=False, vibrato_dampen=0.0)),
        ("06_FIXED_no_formant_no_detune",
            gen_voice_leading(melody, with_safe_range_gate=True),
            dict(formant_factor=1.0, detune_cents=DETUNE_CENTS, in_tune=False, vibrato_dampen=0.5)),
    ]

    for name, hn, kwargs in variants:
        print(f"Rendering {name}...")
        out = render_harmony(audio, sr, hn, world_analysis=world, **kwargs)
        # peak-normalize each variant to -3 dBFS so they are level-matched for comparison
        peak = float(np.max(np.abs(out)))
        if peak > 0:
            out = (out / peak * 0.707).astype(np.float32)
        sf.write(str(OUT / f"{name}.wav"), out, sr)

    # Also write the lead so you can solo it against any variant
    sf.write(str(OUT / "00_lead.wav"), audio, sr)

    print(f"\nDone. Files in {OUT}")
    for f in sorted(OUT.glob("*.wav")):
        info = sf.info(str(f))
        print(f"  {f.name}  ({info.duration:.1f}s)")


if __name__ == "__main__":
    main()
