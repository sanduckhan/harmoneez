"""Pitch shifting utilities."""

import numpy as np


def pitch_shift_world(
    audio: np.ndarray,
    sr: int,
    semitones: int,
    f0_floor: float = 65.0,
    f0_ceil: float = 1000.0,
) -> np.ndarray:
    """
    Pitch-shift audio by N semitones using WORLD vocoder.
    Best for monophonic voice — preserves formants (no chipmunk effect).
    """
    if semitones == 0:
        return audio

    import pyworld as pw

    audio_f64 = audio.astype(np.float64)
    f0, timeaxis = pw.harvest(audio_f64, sr, f0_floor=f0_floor, f0_ceil=f0_ceil)
    sp = pw.cheaptrick(audio_f64, f0, timeaxis, sr)
    ap = pw.d4c(audio_f64, f0, timeaxis, sr)

    f0_shifted = f0 * (2.0 ** (semitones / 12.0))
    output = pw.synthesize(f0_shifted, sp, ap, sr)

    if len(output) > len(audio):
        output = output[:len(audio)]
    elif len(output) < len(audio):
        output = np.pad(output, (0, len(audio) - len(output)))

    return output.astype(np.float32)


def pitch_shift_librosa(
    audio: np.ndarray,
    sr: int,
    semitones: int,
) -> np.ndarray:
    """
    Pitch-shift audio by N semitones using librosa (phase vocoder).
    Best for polyphonic/percussive content (instruments, full mixes).
    Preserves duration.
    """
    if semitones == 0:
        return audio

    import librosa

    shifted = librosa.effects.pitch_shift(
        y=audio.astype(np.float32),
        sr=sr,
        n_steps=semitones,
    )

    return shifted.astype(np.float32)
