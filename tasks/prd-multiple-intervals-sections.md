# PRD: Multiple Harmony Intervals & Section Selection (Iteration 2)

## Introduction

Extend the Harmoneez CLI to support multiple harmony interval types (not just diatonic 3rd above) and allow the user to process only a specific time range of a song. This lets musicians quickly generate and compare different harmony options for a specific section like a chorus.

## Goals

- Support 5 harmony interval types: 3rd above, 3rd below, 5th above, 6th above, octave above
- Generate all interval types by default so the user can compare and pick
- Allow processing a specific section of a song via `--start` and `--end` flags
- Accept time in both seconds (`109`) and mm:ss (`1:49`) formats
- Run key detection and vocal isolation on the full song, but only generate harmony for the selected section
- Maintain backwards compatibility with Iteration 1 behavior

## User Stories

### US-001: Add --interval CLI flag
**Description:** As a user, I want to choose which harmony interval to generate so I can hear different options.

**Acceptance Criteria:**
- [ ] `--interval` flag accepts: `3rd-above`, `3rd-below`, `5th`, `6th`, `octave`, `all`
- [ ] Default is `all` when no `--interval` is specified
- [ ] `--interval all` generates one file pair (harmony + mixed) per interval type
- [ ] Single interval: `--interval 3rd-above` generates only that one
- [ ] Prints an error for unrecognized interval values

### US-002: Implement diatonic 3rd below
**Description:** As a user, I want a harmony a diatonic third below my melody for a lower backing vocal option.

**Acceptance Criteria:**
- [ ] Computes the note 2 diatonic scale degrees below the melody note
- [ ] Harmony note is always below the melody note
- [ ] Applies the same chromatic/melismatic handling rules as 3rd above
- [ ] Output file: `<name>_3rd_below_harmony.wav` and `<name>_3rd_below_mixed.wav`

### US-003: Implement diatonic 5th above
**Description:** As a user, I want a harmony a diatonic fifth above for power-style backing vocals.

**Acceptance Criteria:**
- [ ] Computes the note 4 diatonic scale degrees above the melody note
- [ ] Applies vocal range clamping (drop octave if too high)
- [ ] Output file: `<name>_5th_harmony.wav` and `<name>_5th_mixed.wav`

### US-004: Implement diatonic 6th above
**Description:** As a user, I want a harmony a diatonic sixth above, which is equivalent to a third below transposed up an octave — a common rock harmony.

**Acceptance Criteria:**
- [ ] Computes the note 5 diatonic scale degrees above the melody note
- [ ] Applies vocal range clamping
- [ ] Output file: `<name>_6th_harmony.wav` and `<name>_6th_mixed.wav`

### US-005: Implement octave above
**Description:** As a user, I want an octave doubling for a thicker vocal sound.

**Acceptance Criteria:**
- [ ] Shifts the melody up exactly 12 semitones (no scale degree logic needed)
- [ ] Applies vocal range clamping
- [ ] Output file: `<name>_octave_harmony.wav` and `<name>_octave_mixed.wav`

### US-006: Rename existing output files
**Description:** As a developer, I need to update the output file naming to include the interval type, since we now produce multiple outputs.

**Acceptance Criteria:**
- [ ] 3rd above output: `<name>_3rd_above_harmony.wav` and `<name>_3rd_above_mixed.wav`
- [ ] When `--interval all`, all 5 pairs are generated with their respective names
- [ ] When a single interval is selected, only that pair is generated
- [ ] All output paths are printed on completion

### US-007: Add --start and --end flags for section selection
**Description:** As a user, I want to process only a specific section of a song so I can generate harmonies for just the chorus or a verse.

**Acceptance Criteria:**
- [ ] `--start` and `--end` flags accept seconds (`109`) or mm:ss (`1:49`)
- [ ] `--start` without `--end` processes from start to end of song
- [ ] `--end` without `--start` processes from beginning to end time
- [ ] Neither flag specified processes the full song (current behavior)
- [ ] Prints a clear error if start >= end
- [ ] Prints a clear error if end exceeds song duration
- [ ] Prints the selected time range in the progress output

### US-008: Section-aware pipeline
**Description:** As a developer, I need the pipeline to run vocal isolation and key detection on the full song but only generate harmony for the selected section.

**Acceptance Criteria:**
- [ ] Demucs processes the full audio file (better separation quality)
- [ ] Key detection runs on the full audio (more data = better accuracy)
- [ ] After vocal isolation, the vocal track is cropped to the selected section
- [ ] Basic Pitch melody extraction runs only on the cropped section
- [ ] Harmony generation and rendering run only on the cropped section
- [ ] Output files contain only the selected section, not the full song

## Functional Requirements

- FR-1: The CLI must accept `--interval` flag with values: `3rd-above`, `3rd-below`, `5th`, `6th`, `octave`, `all` (default: `all`)
- FR-2: The CLI must accept `--start` flag in seconds or mm:ss format
- FR-3: The CLI must accept `--end` flag in seconds or mm:ss format
- FR-4: The system must run Demucs and key detection on the full song regardless of section selection
- FR-5: The system must crop the isolated vocal track to the selected section before melody extraction
- FR-6: The system must compute diatonic intervals using scale degree arithmetic: 3rd = ±2 degrees, 5th = +4 degrees, 6th = +5 degrees
- FR-7: The octave interval must shift exactly +12 semitones without scale degree logic
- FR-8: The system must output one file pair (harmony + mixed) per selected interval type
- FR-9: Output files must include the interval type in their filename
- FR-10: The system must apply humanization (panning, timing offset, micro-detuning) to all interval types

## Non-Goals

- No chord-aware harmony (Iteration 5)
- No interactive section selection (Iteration 3 web UI)
- No stacking multiple harmonies into a single mixed file (choir mode — future iteration)
- No pitch correction (Iteration 6)
- No custom interval specification (e.g. "minor 3rd exactly")

## Technical Considerations

### Interval Implementation

The existing `diatonic_third_above()` function uses scale degree index + 2. Generalize to a `diatonic_interval()` function:

```python
def diatonic_interval(midi_pitch, scale_pcs, degrees):
    """
    degrees: +2 = 3rd above, -2 = 3rd below, +4 = 5th, +5 = 6th
    """
```

Octave is a special case — no scale logic, just +12 semitones.

### Time Parsing

```python
def parse_time(time_str: str) -> float:
    """Parse '1:49' or '109' to seconds as float."""
```

### File Naming

When `--interval all`:
```
song_3rd_above_harmony.wav
song_3rd_above_mixed.wav
song_3rd_below_harmony.wav
song_3rd_below_mixed.wav
song_5th_harmony.wav
song_5th_mixed.wav
song_6th_harmony.wav
song_6th_mixed.wav
song_octave_harmony.wav
song_octave_mixed.wav
```

### Performance

Demucs and key detection run once. Melody extraction runs once. Only the harmony generation + rendering loop runs per interval type. The pitch shifting step is the bottleneck — running 5x for `--interval all`. Expected total: ~30-60s for a 20s section.

## Success Metrics

- All 5 interval types produce musically correct harmonies when tested on a real song section
- Section selection correctly crops the output without artifacts at boundaries
- `--interval all` on a 20s section completes in under 60 seconds
- A musician can listen to each variant and identify which interval they prefer

## Resolved Decisions

- **Full-song processing for Demucs + key detection:** Better quality than cropping first. The time cost is acceptable since it runs once.
- **Default interval is `all`:** The whole point is to compare options. User can narrow down with `--interval 3rd-above` once they know what they want.
- **One mixed file per interval (not stacked):** Stacking all harmonies into one file is a separate "choir mode" feature for later.
