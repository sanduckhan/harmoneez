"""Vocal isolation using Demucs v4."""

from pathlib import Path

import numpy as np
import soundfile as sf


def separate_vocals(input_path: Path, tmp_dir: Path) -> tuple[np.ndarray, int]:
    """
    Separate vocals from the input audio using Demucs v4.
    Returns (vocals_mono, sample_rate).
    """
    from demucs.apply import apply_model
    from demucs.audio import AudioFile
    from demucs.pretrained import get_model

    model = get_model("htdemucs")
    sr = model.samplerate

    wav = AudioFile(str(input_path)).read(
        streams=0, samplerate=sr, channels=model.audio_channels
    )
    sources = apply_model(model, wav.unsqueeze(0), device="cpu")

    vocals_idx = model.sources.index("vocals")
    vocals_tensor = sources[0, vocals_idx]

    vocals_np = vocals_tensor.cpu().numpy()
    vocals_mono = np.mean(vocals_np, axis=0)

    vocals_path = tmp_dir / "vocals.wav"
    sf.write(str(vocals_path), vocals_mono, sr)

    return vocals_mono, sr
