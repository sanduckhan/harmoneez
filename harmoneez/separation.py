"""Vocal isolation using Demucs v4."""

import os
from pathlib import Path

import numpy as np
import soundfile as sf

# Let PyTorch silently fall back to CPU for any MPS-unsupported op. Must be set
# before torch is imported by demucs.
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

_DEVICE: str | None = None


def _pick_device() -> str:
    """
    Pick the best available torch device for Demucs.
    Precedence: HARMONEEZ_DEVICE env var > mps (Apple Silicon) > cuda > cpu.
    Cached on first call so the log line is only printed once per process.
    """
    global _DEVICE
    if _DEVICE is not None:
        return _DEVICE

    override = os.getenv("HARMONEEZ_DEVICE")
    if override:
        _DEVICE = override
    else:
        import torch
        if torch.backends.mps.is_available():
            _DEVICE = "mps"
        elif torch.cuda.is_available():
            _DEVICE = "cuda"
        else:
            _DEVICE = "cpu"

    print(f"[harmoneez] Demucs device: {_DEVICE}")
    return _DEVICE


def separate_vocals(input_path: Path, tmp_dir: Path) -> tuple[np.ndarray, np.ndarray, int]:
    """
    Separate vocals from the input audio using Demucs v4.
    Returns (vocals_mono, instrumental_mono, sample_rate).
    """
    from demucs.apply import apply_model
    from demucs.audio import AudioFile
    from demucs.pretrained import get_model

    model = get_model("htdemucs")
    sr = model.samplerate

    wav = AudioFile(str(input_path)).read(
        streams=0, samplerate=sr, channels=model.audio_channels
    )
    sources = apply_model(model, wav.unsqueeze(0), device=_pick_device())

    # Extract vocals
    vocals_idx = model.sources.index("vocals")
    vocals_tensor = sources[0, vocals_idx]
    vocals_np = vocals_tensor.cpu().numpy()
    vocals_mono = np.mean(vocals_np, axis=0)

    # Sum all non-vocal stems into instrumental mix
    instrumental = sum(
        sources[0, i] for i in range(len(model.sources)) if i != vocals_idx
    )
    instrumental_np = instrumental.cpu().numpy()
    instrumental_mono = np.mean(instrumental_np, axis=0)

    # Save both
    sf.write(str(tmp_dir / "vocals.wav"), vocals_mono, sr)
    sf.write(str(tmp_dir / "instrumental.wav"), instrumental_mono, sr)

    return vocals_mono, instrumental_mono, sr
