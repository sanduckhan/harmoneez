# PRD: CLI Vocal Harmony Generator (Iteration 1)

## Introduction

Harmoneez is a CLI tool that helps rock band vocalists generate backing vocal harmonies from a song recording. The user provides a WAV or MP3 file, and the tool automatically isolates the vocals, detects the song key, extracts the melody, and generates a diatonic third harmony. It outputs both a harmony-only track and a mixed track (original vocals + harmony) as WAV files.

This first iteration focuses on proving the full pipeline end-to-end as a Python CLI script — no UI, no advanced harmony options, just a working prototype that takes a song in and produces a usable harmony track out.

## Goals

- Deliver a working end-to-end pipeline from audio input to harmony audio output
- Automatically detect the song key and let the user confirm or override it
- Generate a musically correct diatonic third harmony above the vocal melody
- Output two files: a harmony-only track and a mixed (original vocals + harmony) track
- Keep the CLI simple — one command, minimal required arguments

## User Stories

### US-001: Project Setup
**Description:** As a developer, I need a Python project with all dependencies configured so I can start building the pipeline.

**Acceptance Criteria:**
- [ ] Python project initialized with pyproject.toml or requirements.txt
- [ ] All dependencies installable: demucs, basic-pitch, essentia (or librosa), music21, pyrubberband, pydub
- [ ] A virtual environment can be created and all deps install without conflicts
- [ ] A `harmonize.py` entry point exists and runs without error (even if it does nothing yet)
- [ ] rubberband CLI tool is documented as a system dependency (required by pyrubberband)

### US-002: Audio File Input
**Description:** As a user, I want to provide a song file so the tool can process it.

**Acceptance Criteria:**
- [ ] CLI accepts a positional argument for the input file path
- [ ] Supports WAV and MP3 formats
- [ ] Prints a clear error and exits with non-zero code if the file does not exist
- [ ] Prints a clear error and exits if the file format is not WAV or MP3
- [ ] Prints a clear error and exits if the file is unreadable or corrupt

### US-003: Vocal Isolation
**Description:** As a user, I want the tool to extract the vocal track from my song so harmonies can be generated from just the voice.

**Acceptance Criteria:**
- [ ] Uses Demucs v4 to separate the input audio into stems
- [ ] Extracts the vocal stem for downstream processing
- [ ] Intermediate stem files are not kept after processing completes
- [ ] Prints progress feedback (e.g. "Isolating vocals...")
- [ ] Prints a clear error and exits if separation fails (e.g. audio too short, empty file)

### US-004: Key Detection with User Confirmation
**Description:** As a user, I want the tool to detect the song key and let me confirm or override it, because automatic detection can be wrong.

**Acceptance Criteria:**
- [ ] Detects the key of the song from the audio (using Essentia or librosa + Krumhansl-Schmuckler)
- [ ] Prints the detected key (e.g. "Detected key: G major")
- [ ] Prints a warning if a potential key change is detected in the song
- [ ] Prompts the user to confirm (Enter to accept) or type a different key
- [ ] Accepts key input in a simple format (e.g. "Gm", "G major", "Ab minor")
- [ ] Optional CLI flag `--key` to skip the prompt and set the key directly
- [ ] Prints a clear error and exits if the user provides an unrecognized key format

### US-005: Melody Extraction
**Description:** As a user, I want the tool to detect the notes being sung so it knows what to harmonize.

**Acceptance Criteria:**
- [ ] Uses Basic Pitch to transcribe the isolated vocal track to MIDI note data
- [ ] Extracts note pitches, onset times, and durations
- [ ] Prints progress feedback (e.g. "Extracting melody...")
- [ ] Prints a clear error and exits if no notes are detected

### US-006: Diatonic Third Harmony Generation
**Description:** As a user, I want the tool to generate a harmony line a diatonic third above my melody so I can hear what a backing vocal would sound like.

**Acceptance Criteria:**
- [ ] For each melody note, computes the note a diatonic third above in the detected/confirmed key
- [ ] Uses music21 for interval and scale calculations
- [ ] Harmony notes stay within a reasonable vocal range (not absurdly high)
- [ ] If a melody note falls outside the key (accidental/chromatic), uses the nearest scale degree for the harmony calculation
- [ ] Notes shorter than 100ms are skipped — the previous harmony note is sustained through instead (avoids artifacts on fast melismatic passages)
- [ ] Outputs the harmony as a sequence of notes with timing matching the original melody

### US-007: Audio Rendering via Pitch Shifting
**Description:** As a user, I want to hear the harmony as a shifted version of my actual voice, not a synthetic beep.

**Acceptance Criteria:**
- [ ] For each melody note, calculates the pitch shift interval (in semitones) to reach the harmony note
- [ ] Uses pyrubberband to pitch-shift segments of the isolated vocal track
- [ ] Reassembles the shifted segments into a continuous harmony audio track
- [ ] The harmony track has the same duration and alignment as the original vocal track
- [ ] Silence in the original vocal remains silence in the harmony track

### US-008: Output Files
**Description:** As a user, I want two output files: the harmony by itself and a mix of original vocals plus harmony.

**Acceptance Criteria:**
- [ ] Outputs `<input_name>_harmony.wav` — the harmony track only
- [ ] Outputs `<input_name>_mixed.wav` — original vocals + harmony mixed together
- [ ] Mixed track balances both voices (harmony at 70% volume relative to original by default)
- [ ] Both files are standard WAV format, same sample rate as input
- [ ] Intermediate files (stems, MIDI data) are cleaned up — only the two output files remain
- [ ] Prints the output file paths on completion

### US-009: End-to-End CLI Flow
**Description:** As a user, I want a single command that runs the full pipeline with clear progress output.

**Acceptance Criteria:**
- [ ] Full command: `python harmonize.py song.wav` runs the entire pipeline
- [ ] With key override: `python harmonize.py song.wav --key Gmajor` skips the key prompt
- [ ] With volume override: `python harmonize.py song.wav --harmony-volume 0.5` adjusts harmony level in mix
- [ ] Prints step-by-step progress: isolating vocals, detecting key, extracting melody, generating harmony, rendering audio
- [ ] Prints total processing time on completion
- [ ] Exits with code 0 on success, non-zero on any error
- [ ] Works on macOS (primary) and Linux

## Functional Requirements

- FR-1: The CLI must accept a positional argument for the input audio file path (WAV or MP3)
- FR-2: The CLI must accept an optional `--key` flag to override automatic key detection (e.g. `--key Gmajor`)
- FR-2b: The CLI must accept an optional `--harmony-volume` flag (0.0 to 1.0, default 0.7) to control harmony level in the mixed output
- FR-3: The system must separate the input audio into stems using Demucs v4 and extract the vocal track
- FR-4: The system must detect the musical key of the song and prompt the user to confirm or override it
- FR-4b: The system must print a warning if a potential key change is detected (but still use the dominant key throughout)
- FR-5: The system must transcribe the isolated vocal track to note data (pitch, onset, duration) using Basic Pitch
- FR-6: The system must compute a diatonic third above each melody note in the confirmed key using music21
- FR-6b: The system must skip notes shorter than 100ms and sustain the previous harmony note through (melismatic passage handling)
- FR-7: The system must pitch-shift segments of the isolated vocal to match the harmony notes using pyrubberband
- FR-8: The system must output a harmony-only WAV file (`<name>_harmony.wav`)
- FR-9: The system must mix the original vocal and harmony tracks and output a mixed WAV file (`<name>_mixed.wav`)
- FR-10: The system must delete all intermediate files (stems, temp audio) after producing the final outputs
- FR-11: The system must print progress messages for each pipeline step
- FR-12: The system must print clear error messages and exit with non-zero code on failure

## Non-Goals

- No web UI or graphical interface (Iteration 3)
- No multiple harmony types — only diatonic 3rd above (Iteration 2)
- No chord-aware harmony — key-only for now (Iteration 5)
- No piano roll or note visualization (Iteration 4)
- No real-time processing or streaming — batch only
- No MIDI file export
- No voice range selection or vocal type configuration
- No formant-preserving pitch shift (WORLD vocoder is Iteration 6)
- No Windows support required for this iteration

## Technical Considerations

### Dependencies

| Library       | Purpose                          | Install                    |
|---------------|----------------------------------|----------------------------|
| demucs        | Vocal isolation (source sep.)    | `pip install demucs`       |
| basic-pitch   | Vocal-to-MIDI transcription      | `pip install basic-pitch`  |
| essentia      | Key detection                    | `pip install essentia-tensorflow` |
| music21       | Music theory / interval math     | `pip install music21`      |
| pyrubberband  | Pitch shifting                   | `pip install pyrubberband` |
| pydub         | Audio mixing / WAV output        | `pip install pydub`        |

### System Dependencies

- `rubberband` CLI tool (required by pyrubberband): `brew install rubberband` on macOS
- `ffmpeg` (required by pydub for MP3 reading and by demucs): `brew install ffmpeg`
- Python 3.9+ (required by demucs and basic-pitch)

### Architecture

Single-file script (`harmonize.py`) with functions for each pipeline step. No classes or abstractions needed at this stage. Each function takes the output of the previous step as input.

```
main()
├── parse_args()
├── load_audio(input_path)
├── separate_vocals(audio) -> vocal_track
├── detect_key(audio) -> key
├── confirm_key(key) -> confirmed_key
├── extract_melody(vocal_track) -> notes[]
├── generate_harmony(notes, key) -> harmony_notes[]
├── render_harmony(vocal_track, notes, harmony_notes) -> harmony_audio
├── mix_tracks(vocal_track, harmony_audio) -> mixed_audio
├── save_outputs(harmony_audio, mixed_audio)
└── cleanup_temp_files()
```

### Performance Expectations

- Demucs: ~1 min per 4-min song on laptop CPU (M1/M2 Mac)
- Basic Pitch: ~10-20 seconds
- Key detection: < 5 seconds
- Harmony generation: instant
- Pitch shifting: ~30 seconds depending on note count
- Total: ~2 minutes for a typical song

## Success Metrics

- Pipeline completes without error on at least 3 different rock songs
- Generated harmony is musically correct (diatonic third in the right key)
- Output audio is listenable — no major artifacts, glitches, or silence gaps
- A musician can listen to the mixed output and evaluate whether the harmony works

## Resolved Decisions

- **Harmony volume:** Default to 70%, configurable via `--harmony-volume` flag (0.0–1.0)
- **Key changes:** Detect dominant key only. Print a warning if a key change is suspected, but use the dominant key throughout
- **Melismatic passages:** Skip notes shorter than 100ms and sustain the previous harmony note through instead — avoids pitch-shift artifacts and mimics what a real backing vocalist would do
- **Essentia AGPL license:** Accepted — this is a personal tool, AGPL is fine
