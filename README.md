# Harmoneez

CLI tool that generates vocal harmonies from song recordings. Drop a WAV or MP3, get a diatonic third harmony track back.

## System Requirements

- Python 3.10+ (tested with 3.11)
- macOS or Linux
- [rubberband](https://breakfastquay.com/rubberband/) — audio pitch shifting
- [ffmpeg](https://ffmpeg.org/) — audio format handling

### macOS (Homebrew)

```bash
brew install rubberband ffmpeg
```

## Setup

```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Usage

```bash
# Basic — detects key automatically, prompts for confirmation
python harmonize.py song.wav

# Override key (skips prompt)
python harmonize.py song.wav --key Gm

# Adjust harmony volume in the mix (0.0–1.0, default: 0.7)
python harmonize.py song.wav --harmony-volume 0.5
```

## Output

The tool produces two files next to the input:

- `song_harmony.wav` — the harmony track only
- `song_mixed.wav` — original vocals + harmony mixed together

## How It Works

1. **Vocal isolation** — Demucs v4 separates the vocal track from instruments
2. **Key detection** — Chromagram analysis with Temperley profiles detects the song key
3. **Melody extraction** — Basic Pitch transcribes the vocal melody to notes
4. **Harmony generation** — Computes a diatonic third above each note using music21
5. **Audio rendering** — Pitch-shifts vocal segments with rubberband
6. **Mixing** — Combines original vocals with the harmony track

## Key Format Examples

```
G           → G major
Gm          → G minor
G major     → G major
Ab minor    → Ab minor
F#m         → F# minor
```
