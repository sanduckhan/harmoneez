# Harmoneez — Iteration Plan

Vocal harmony generation tool for rock bands.
Drop a recording, detect the key, extract the melody, generate harmony options, preview and pick.

---

## Pipeline Overview

```
Audio File --> [Source Separation] --> Isolated Vocals (Demucs v4)
          --> [Key Detection]     --> Song Key (Essentia KeyExtractor)

Isolated Vocals --> [Pitch Correction] --> Corrected Vocals (WORLD vocoder, 80%)
                --> [Melody Extraction] --> Note Sequence (Basic Pitch)

Note Sequence + Key --> [Harmony Generation] --> Harmony Notes (music21)

Harmony Notes --> [Audio Rendering] --> Harmony Track (WORLD vocoder)
              --> [Humanization]    --> Panning + timing offset + micro-detuning
              --> [Mixing]          --> Stereo mixed output
```

---

## Iteration 1 — CLI Proof of Concept

**Goal:** Drop a WAV file, get a harmony audio file back.

**Status:** Done

### What was built

- [x] Python project with venv (Python 3.11 ARM64)
- [x] Accept WAV/MP3 input via CLI
- [x] Vocal isolation with Demucs v4
- [x] Key detection with Essentia KeyExtractor (bgate profile)
- [x] Melody extraction with Basic Pitch
- [x] Diatonic third harmony generation with music21
- [x] Audio rendering (initially pyrubberband, later upgraded to WORLD)
- [x] Stereo mixing with humanization (panning, timing offset, micro-detuning)
- [x] `--key` override flag with interactive confirmation
- [x] `--harmony-volume` flag (default 0.7)

---

## Iteration 2 — Multiple Intervals, Sections & Quality

**Goal:** Multiple harmony types, section selection, pitch correction, better rendering.

**Status:** Done

### What was built

- [x] 8 interval types: 3rd-above, 3rd-below, 5th, 6th, octave, unison, drone-root, drone-5th
- [x] `--interval` flag (default: all)
- [x] `--start` / `--end` flags for section selection (seconds or mm:ss format)
- [x] Full-song vocal isolation + key detection, section-only harmony generation
- [x] Frame-by-frame pitch correction using WORLD vocoder (80% strength, on by default)
- [x] `--no-pitch-correct` flag to skip
- [x] Corrected vocal saved as separate output file
- [x] WORLD vocoder for harmony rendering (replaced pyrubberband — eliminates chipmunk effect)
- [x] Diminished interval correction (tritone → perfect 5th)
- [x] Correct chromatic fallback per interval type
- [x] Note gating to prevent WORLD artifacts between notes

---

## Iteration 3 — Web UI for Playback

**Goal:** Visual interface to upload, preview, and toggle harmonies.

**Status:** Not started

### Tasks

- [ ] FastAPI backend wrapping the Python pipeline
- [ ] React frontend scaffold
- [ ] Drag-and-drop file upload
- [ ] Waveform display with WaveSurfer.js
- [ ] Section selection on the waveform (visual --start/--end)
- [ ] Play/pause with harmony tracks as toggleable layers
- [ ] Volume sliders per harmony voice
- [ ] Display detected key with override dropdown
- [ ] Interval type selector
- [ ] Loading states / progress bar for processing steps

### Tech

| Block         | Library              |
|---------------|----------------------|
| Backend       | FastAPI              |
| Frontend      | React + TypeScript   |
| Waveform      | WaveSurfer.js        |
| Audio playback| Tone.js / Web Audio  |

### Risks

- Medium. Full-stack wiring but no new audio/ML challenges.

---

## Iteration 4 — Piano Roll & Note Editing

**Goal:** See detected melody + generated harmonies as editable notes.

**Status:** Not started

### Tasks

- [ ] Piano roll component rendering MIDI notes visually
- [ ] Manual correction of detected notes (drag/snap to grid)
- [ ] Manual editing of harmony notes
- [ ] Re-render audio on edit
- [ ] Zoom and scroll controls

### Risks

- Medium. Piano roll interaction is the main UI challenge.

---

## Iteration 5 — Chord-Aware Harmonies

**Goal:** Harmonies follow the chord progression, not just the key. Also enables smarter drone behavior (follow chord roots instead of key root).

**Status:** Not started

### Tasks

- [ ] Chord detection (Essentia or chroma-based)
- [ ] Chord-tone harmonization: harmony voice targets nearest chord tone instead of fixed diatonic interval
- [ ] Drone follows chord root instead of key root
- [ ] Better voice leading (minimize jumps between notes)
- [ ] Interval switching within phrases (start on 3rd, resolve to unison)
- [ ] A/B comparison: key-only vs chord-aware harmonies

### Risks

- Medium-high. Chord detection accuracy varies. Music theory logic gets more complex.

---

## Iteration 6 — Advanced Harmony Techniques

**Goal:** More sophisticated harmony arrangements beyond parallel intervals.

**Status:** Not started

### Tasks

- [ ] Contrary motion option (harmony moves opposite to melody)
- [ ] Oblique motion / pedal tone (harmony holds a note while melody moves)
- [ ] Call and response (harmony echoes lead with delay)
- [ ] Rhythmic variation (harmony sustains while lead does runs)
- [ ] Dynamic arrangement presets (sparse verse → full chorus)
- [ ] Multi-part harmony stacking (3-4 voices combined in one output)

### Risks

- High. These require musical intelligence beyond simple interval math. Some may need ML approaches.

---

## Iteration 7 — Polish & Distribution

**Goal:** Production-quality output and distribution.

**Status:** Not started

### Tasks

- [ ] Partial formant shifting (20-30% blend to sound like a different singer)
- [ ] Neural voice conversion (RVC) for most natural pitch shifting
- [ ] Export as multi-track stems
- [ ] Export as MIDI
- [ ] Desktop packaging (Tauri or Electron)
- [ ] VST/AU plugin (JUCE, long-term)

---

## Architecture Notes

**Current tech stack:**
- Single-file CLI: `harmonize.py` (~750 lines)
- Python 3.11 (ARM64 via `/opt/homebrew/Cellar/python@3.11/`)
- Virtual environment: `.venv/`

**Key libraries:**
| Purpose            | Library        | Why                                      |
|--------------------|----------------|------------------------------------------|
| Vocal isolation     | Demucs v4      | Best open-source, MIT, ~1min/song on CPU |
| Pitch to notes      | Basic Pitch    | MIDI output in one call, polyphony-aware |
| Key detection       | Essentia       | 80%+ accuracy with bgate profile         |
| Music theory        | music21        | Intervals, scales, keys                  |
| Pitch correction    | pyworld        | Frame-by-frame WORLD vocoder             |
| Harmony rendering   | pyworld        | Formant-preserving pitch shifting        |
| Audio I/O           | soundfile      | WAV read/write                           |
