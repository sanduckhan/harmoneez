# Harmoneez — Iteration Plan

Vocal harmony generation tool for rock bands.
Drop a recording, detect the key, extract the melody, generate harmony options, preview and pick.

---

## Pipeline Overview

```
Audio File --> [Source Separation] --> Isolated Vocals
          --> [Key Detection]     --> Song Key

Isolated Vocals --> [Pitch Detection] --> Note Sequence (MIDI)

Note Sequence + Key --> [Harmony Generation] --> Harmony Note Sequences

Harmony Notes --> [Audio Rendering] --> Playable Harmony Tracks
```

---

## Iteration 1 — CLI Proof of Concept

**Goal:** Drop a WAV file, get a harmony audio file back.

**Status:** Not started

### Tasks

- [ ] Project setup (Python env, dependencies)
- [ ] Accept WAV/MP3 input file via CLI
- [ ] Run Demucs v4 to isolate vocals
- [ ] Run Basic Pitch to convert vocals to MIDI notes
- [ ] Run key detection (Essentia or librosa + Krumhansl-Schmuckler)
- [ ] Generate a diatonic third harmony using music21
- [ ] Pitch-shift the vocal track with pyrubberband
- [ ] Mix original + harmony with pydub, output a WAV
- [ ] End-to-end test with a real song

### Tech

| Block             | Library           | License    |
|-------------------|-------------------|------------|
| Source separation  | Demucs v4         | MIT        |
| Pitch detection    | Basic Pitch       | Apache 2.0 |
| Key detection      | Essentia / librosa| AGPL / ISC |
| Music theory       | music21           | MIT        |
| Pitch shifting     | pyrubberband      | MIT        |
| Audio mixing       | pydub             | MIT        |

### Risks

- Low overall. All libraries are proven.
- Key detection may confuse relative major/minor — user override needed later.

### Output

A CLI script: `python harmonize.py song.wav` --> `song_harmony.wav`

---

## Iteration 2 — Multiple Harmony Options

**Goal:** Generate several harmony variants to choose from.

**Status:** Not started

### Tasks

- [ ] Add harmony types: 3rd above, 3rd below, 5th, 6th, octave
- [ ] Output separate files per harmony variant
- [ ] CLI flag to override detected key
- [ ] Voice range clamping (keep harmonies in singable range)
- [ ] Compare output quality across interval types

### Output

Multiple files: `song_3rd_above.wav`, `song_5th_above.wav`, etc.

---

## Iteration 3 — Web UI for Playback

**Goal:** Visual interface to upload, preview, and toggle harmonies.

**Status:** Not started

### Tasks

- [ ] FastAPI backend wrapping the Python pipeline
- [ ] React frontend scaffold
- [ ] Drag-and-drop file upload
- [ ] Waveform display with WaveSurfer.js
- [ ] Play/pause with harmony tracks as toggleable layers
- [ ] Volume sliders per harmony voice
- [ ] Display detected key with override dropdown
- [ ] Loading states for processing steps

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

**Goal:** Harmonies follow the chord progression, not just the key.

**Status:** Not started

### Tasks

- [ ] Chord detection (Essentia or chroma-based)
- [ ] Harmony generator picks notes from the current chord
- [ ] Better voice leading (minimize jumps between notes)
- [ ] A/B comparison: key-only vs chord-aware harmonies

### Risks

- Medium-high. Chord detection accuracy varies. Music theory logic gets more complex.

---

## Iteration 6 — Pitch Correction

**Goal:** Optional pitch correction of the input vocal before harmony generation, improving harmony quality.

**Status:** Not started

### Tasks

- [ ] Frame-by-frame pitch detection on isolated vocal (CREPE or pYIN)
- [ ] For each frame, compute cent deviation from nearest scale degree in confirmed key
- [ ] Apply micro pitch-shifts to correct toward target (70-80% correction to stay natural)
- [ ] Use corrected vocal as source for both melody extraction and harmony rendering
- [ ] `--pitch-correct` CLI flag (off by default)
- [ ] A/B comparison: corrected vs uncorrected harmony output

### Why

Pitch-shifted harmony inherits tuning errors from the original vocal. If the singer is 20 cents flat, the harmony is also off. Correcting the source before shifting produces cleaner intervals and a more polished result.

### Risks

- Medium. Too aggressive = robotic autotune sound. Need to find the right correction amount.

---

## Iteration 7 — Polish & Advanced Features

**Goal:** Production-quality output and distribution.

**Status:** Not started

### Tasks

- [ ] WORLD vocoder (pyworld) for better wide-interval harmonies
- [ ] Harmony style presets (rock power fifths, gospel, barbershop)
- [ ] Export as multi-track stems
- [ ] Export as MIDI
- [ ] Desktop packaging (Tauri or Electron)
- [ ] VST/AU plugin (JUCE, long-term)

---

## Architecture Notes

**Tech stack (target):**
- Backend: Python (FastAPI) — all ML/audio libs are Python-native
- Frontend: React + WaveSurfer.js + Tone.js
- Communication: REST API + file-based (upload audio, get back processed files)

**Key libraries:**
| Purpose            | Library        | Why                                      |
|--------------------|----------------|------------------------------------------|
| Vocal isolation     | Demucs v4      | Best open-source, MIT, ~1min/song on CPU |
| Pitch to notes      | Basic Pitch    | MIDI output in one call, polyphony-aware |
| Key detection       | Essentia       | 80%+ accuracy, pre-trained models        |
| Music theory        | music21        | Intervals, scales, keys, MIDI I/O        |
| Pitch shifting      | pyrubberband   | Industry standard, formant preservation  |
| Vocoder (advanced)  | pyworld        | Best for large intervals                 |
| Audio mixing        | pydub          | Simple overlay API                       |
