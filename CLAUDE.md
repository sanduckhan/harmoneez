# Harmoneez

Vocal harmony generator for rock bands. Takes a song recording, isolates vocals, detects the key, and generates diatonic harmony variants.

## Project Structure

```
harmoneez/          # Python package (core pipeline)
cli.py              # CLI entry point
server.py           # FastAPI backend with WebSocket progress
frontend/           # React + TypeScript + Vite
tasks/              # PRDs for each iteration
```

## Design System

See [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) for the full visual identity reference:
- **Aesthetic**: Analog Studio (recording console / VU meter inspired)
- **Primary accent**: Amber (`#f5a623`) — not purple
- **Fonts**: Instrument Serif (brand), JetBrains Mono (data/UI), DM Sans (body)
- **Dark theme only**: Deep blacks with warm amber accents

All frontend components must follow the design system. Use CSS variable tokens (`--bg-panel`, `--amber`, `--text-muted`, etc.) instead of raw Tailwind colors.

## Running Locally

```bash
# Backend
source .venv/bin/activate
python server.py

# Frontend
cd frontend && npm run dev
```

## CLI

```bash
python cli.py song.wav --key Ebm --start 1:49 --end 2:07 --interval all
```

## Key Technical Decisions

- **WORLD vocoder** for pitch shifting (not rubberband) — formant-preserving, eliminates chipmunk effect
- **Essentia KeyExtractor** (bgate profile) for key detection — 80%+ accuracy on rock
- **pyworld** for pitch correction — frame-by-frame, 80% strength
- **Demucs v4** for vocal isolation
- **Basic Pitch** for melody extraction
