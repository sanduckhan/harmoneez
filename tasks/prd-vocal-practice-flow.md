# PRD: Vocal Practice & Recording Flow (Iteration 4)

## Introduction

Redesign the core UX around a vocal practice workflow. Instead of "upload → process → results", the app becomes a **vocal training tool with harmony generation**: upload a reference song, see the extracted melody as a scrolling pitch guide, record yourself singing over it with real-time pitch feedback, review your accuracy, then generate harmonies on selected sections.

This replaces the current upload-first flow as the primary experience. The existing "upload a vocal file directly" flow remains available as a secondary option.

---

## Core Experience

```
Upload reference song
    → Extract vocals + detect key + extract melody (background processing)
    → Show scrolling pitch guide (melody line)
    → Record over it (see your pitch in real-time, overlaid on guide)
    → Stop recording
    → Review pitch accuracy
    → Select section on recording timeline
    → Generate harmonies
    → Listen, compare, download
```

---

## Goals

- Let the vocalist see the melody they should be singing as a scrolling pitch line
- Show their own pitch in real-time while recording, colored by accuracy
- Make it obvious where they're in tune vs off-pitch
- Let them select sections and generate harmonies from their recording
- Keep the existing "upload vocal directly" flow as a secondary path

---

## User Stories

### US-020: Upload reference track and extract melody
**Description:** As a user, I want to upload the original song so the app can extract the vocal melody for me to sing along with.

**Acceptance Criteria:**
- [ ] Upload a WAV/MP3 (same drag-and-drop as current)
- [ ] Backend processes: Demucs vocal separation → Basic Pitch melody extraction → key detection
- [ ] Processing happens in the background with progress indicator
- [ ] When done, the app transitions to the pitch guide view
- [ ] The extracted melody is returned as a list of notes with pitch + timing

### US-021: Scrolling pitch guide display
**Description:** As a user, I want to see the melody I should be singing as a scrolling line, like a music game.

**Acceptance Criteria:**
- [ ] Full-screen-width canvas showing pitch on the Y axis, time on the X axis
- [ ] The melody is drawn as a line/ribbon on the canvas (dim color, e.g. gray with slight opacity)
- [ ] The view scrolls right-to-left: upcoming notes come from the right, past notes exit left
- [ ] A fixed vertical marker in the center represents "now"
- [ ] ~10-15 seconds of music visible at once
- [ ] Y axis covers the vocal range of the song (auto-scaled to the melody's pitch range)
- [ ] No waveform — just the pitch line on a dark background
- [ ] Grid lines for each semitone (subtle, like staff lines)
- [ ] Note names on the Y axis (e.g. Eb4, F4, Gb4)
- [ ] The guide scrolls in sync with the reference track playback

### US-022: Real-time pitch recording with visual feedback
**Description:** As a user, I want to record my voice and see my pitch drawn on the same canvas as the guide melody, in real-time.

**Acceptance Criteria:**
- [ ] Mic input captured via Web Audio API
- [ ] Real-time pitch detection in the browser (Web Audio analyser + autocorrelation or similar)
- [ ] User's pitch drawn as a second line on the same canvas, overlaid on the guide
- [ ] Color coding based on accuracy:
  - Green/teal: within 20 cents of the guide melody
  - Amber: 20-40 cents off
  - Red: > 40 cents off
  - No color (gap) when not singing
- [ ] The guide melody scrolls during recording; user's pitch draws at the fixed marker position
- [ ] Reference track audio plays through speakers (with mute toggle + "use headphones" hint)

### US-023: Recording controls
**Description:** As a user, I need clear controls to manage recording.

**Acceptance Criteria:**
- [ ] Play/Record button: starts both playback and mic recording simultaneously
- [ ] Stop button: ends recording and playback
- [ ] Elapsed time display
- [ ] Mic level indicator (VU-style bar)
- [ ] Mute toggle for reference track audio (visual guide keeps scrolling)
- [ ] After stopping: the recorded pitch line remains visible on the canvas

### US-024: Post-recording pitch accuracy review
**Description:** As a user, I want to review how well I sang before generating harmonies.

**Acceptance Criteria:**
- [ ] After recording, the full canvas shows the guide melody + recorded pitch side by side
- [ ] Can scroll/scrub through the recording to see different sections
- [ ] Overall accuracy score shown (percentage of frames within 20 cents)
- [ ] Pitch accuracy color bar below the canvas (same as existing PitchBar)
- [ ] Option to re-record if not happy
- [ ] Option to proceed to harmony generation

### US-025: Section selection on recording
**Description:** As a user, I want to select which section of my recording to harmonize.

**Acceptance Criteria:**
- [ ] Drag on the pitch canvas to select a time range
- [ ] Selected region highlighted
- [ ] Start/end times displayed
- [ ] "Generate Harmonies" button becomes active when a section is selected

### US-026: Mode selection on landing page
**Description:** As a user, I want to choose between recording over a reference track or uploading an existing vocal file.

**Acceptance Criteria:**
- [ ] Landing page shows two options:
  - "Record Over a Track" — primary, larger, prominent
  - "Upload a Vocal File" — secondary, smaller, text link style
- [ ] "Record Over a Track" leads to the new pitch guide + recording flow
- [ ] "Upload a Vocal File" leads to the existing flow (upload → settings → generate)
- [ ] Both flows share the same results view (interval cards, download)

---

## Functional Requirements

- FR-1: Backend must extract melody notes and return them as JSON (pitch + onset + duration) for the pitch guide
- FR-2: Melody data endpoint: `GET /api/melody/{job_id}` returns `[{start, end, midi_pitch, hz}]`
- FR-3: Real-time pitch detection must run in the browser at ~30fps minimum (no server round-trip)
- FR-4: The scrolling canvas must render at 60fps with no jank during recording
- FR-5: The pitch guide and user's pitch must share the same Y-axis scale (auto-fit to the melody's range ±2 semitones)
- FR-6: Reference track playback and mic recording must start simultaneously
- FR-7: The recorded audio is uploaded to the server for processing (same pipeline as before)
- FR-8: The pitch guide continues to work after recording for review/scrubbing

---

## Non-Goals

- No real-time harmony preview during recording (too complex, latency issues)
- No multi-take management (re-record replaces previous)
- No BPM detection or metronome
- No MIDI export of the pitch guide
- No gamification (scoring, achievements, etc.)
- No video recording

---

## Technical Considerations

### Real-Time Pitch Detection in Browser
- Use Web Audio API `AnalyserNode` with autocorrelation algorithm (YIN or McLeod)
- Libraries to evaluate: `pitchy` (npm), `ml5.js` (has CREPE), or hand-rolled autocorrelation
- Must run in `requestAnimationFrame` loop — no Web Workers needed for ~30fps at speech/singing frequencies
- Output: Hz value per frame, converted to MIDI note number for Y-axis positioning

### Scrolling Pitch Canvas
- HTML5 `<canvas>` rendering at 60fps
- Double-buffer or incremental drawing for performance
- Coordinate system: X = time (10-15 second window), Y = MIDI pitch (auto-scaled)
- Fixed "now" marker at ~70% from left (so you see more upcoming than past)
- Guide melody pre-rendered as path data from the note events
- User's pitch appended in real-time as new samples arrive

### Melody Data
- After Demucs + Basic Pitch processing, the melody is already extracted as note events
- Convert to JSON: `[{start_sec, end_sec, midi_pitch, hz, note_name}]`
- Serve via new endpoint or include in the upload processing result
- For the pitch guide, convert discrete note events into a continuous "target pitch" function that the scrolling canvas can query

### Audio Sync
- `AudioContext.currentTime` as the master clock
- Reference track loaded as `AudioBufferSourceNode` (precise timing) or `<audio>` element
- MediaRecorder runs from the same `AudioContext` for tight sync
- The canvas animation loop reads `currentTime` to know what to draw

### Design System
- The pitch canvas replaces the waveform as the main visual element
- Use amber for the guide melody, teal/amber/red for user's pitch
- Dark background with subtle semitone grid lines
- The "now" marker: a vertical line in amber with subtle glow

---

## Success Metrics

- User can see the melody guide and understand what notes to sing within 5 seconds of looking at it
- Real-time pitch drawing has no perceptible lag (< 50ms latency from singing to visual)
- A vocalist can complete the full flow (upload → record → review → generate) in under 5 minutes
- The pitch accuracy colors clearly show where the vocalist needs to improve
