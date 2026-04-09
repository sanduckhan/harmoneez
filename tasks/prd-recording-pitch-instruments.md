# PRD: Recording, Pitch View & Instrumental Backing (Iteration 3b)

## Introduction

Extend the Harmoneez web UI with three features that complete the vocal workflow: record your voice directly in the browser over the original track, see where you're singing in tune vs off-pitch, and preview harmonies with the instrumental backing.

This builds on Iteration 3a (upload, waveform, section selection, harmony generation, results grid).

---

## Goals

- Record vocals in-browser while the original track plays (with mute toggle)
- Display a simple pitch accuracy color bar after processing
- Toggle instrumental backing during harmony playback
- All features run locally — no cloud, no latency

---

## User Stories

### US-013: Upload reference track for recording
**Description:** As a user, I want to upload the original song (full band recording) and then record my voice over it.

**Acceptance Criteria:**
- [ ] After uploading a file, a "Record Over This" button appears alongside the existing workflow
- [ ] Clicking it switches to recording mode: waveform stays visible, mic input is captured
- [ ] The uploaded track plays through speakers/headphones during recording (monitoring)
- [ ] A mute toggle silences the audio playback but keeps the waveform scrolling as a visual guide
- [ ] Recording captures mic input only (not the playback audio)
- [ ] When recording stops, the recorded vocal is treated as a new input — same as if the user uploaded a vocal file
- [ ] The user can re-record (replaces the previous take)

### US-014: Recording controls
**Description:** As a user, I need clear controls to start, stop, and manage recording.

**Acceptance Criteria:**
- [ ] "Record" button with a red indicator (LED-style, matching design system)
- [ ] Pulsing red dot during active recording
- [ ] Timer showing recording duration
- [ ] "Stop" button to end recording
- [ ] After stopping: playback controls to review the take
- [ ] "Re-record" to discard and start over
- [ ] "Use This Take" button to proceed to the harmony pipeline with the recording
- [ ] Section selection (drag on waveform) works on the recording just like on uploaded files

### US-015: Microphone permissions
**Description:** As a user, I need the app to request mic access and handle permission states gracefully.

**Acceptance Criteria:**
- [ ] Browser mic permission requested only when the user clicks "Record Over This"
- [ ] If denied, show a clear message explaining how to enable it
- [ ] If no microphone detected, show appropriate error
- [ ] Mic input level indicator (simple VU-style bar) so user knows the mic is picking up audio

### US-016: Pitch accuracy color bar
**Description:** As a user, I want to see where I'm singing in tune after the harmony pipeline processes my vocal.

**Acceptance Criteria:**
- [ ] After processing, a thin color bar appears below the waveform
- [ ] Color coding per time segment:
  - Green: in tune (< 20 cents deviation from nearest scale degree)
  - Amber/yellow: slightly off (20-40 cents)
  - Red: significantly off (> 40 cents)
  - Gray: no vocal detected (silence/unvoiced)
- [ ] The bar aligns with the waveform timeline — scrolls and zooms together
- [ ] Hovering over a segment shows a tooltip: "A4 → target: Bb4, +35 cents sharp"
- [ ] The pitch data comes from the server (same WORLD analysis used for pitch correction)
- [ ] The bar is visible in both upload and recording workflows

### US-017: Pitch data API endpoint
**Description:** As a developer, I need the server to return pitch analysis data for the frontend to render.

**Acceptance Criteria:**
- [ ] `GET /api/pitch-data/{job_id}` returns JSON array of pitch frames
- [ ] Each frame: `{ time: float, actual_hz: float | null, target_hz: float | null, deviation_cents: float | null, note_name: string | null }`
- [ ] Frame resolution: ~10ms (matching WORLD's analysis frame rate)
- [ ] `actual_hz` is null for unvoiced/silent frames
- [ ] Data is computed during the pitch correction step (no extra processing needed)
- [ ] Endpoint is available after processing completes

### US-018: Instrumental backing toggle
**Description:** As a user, I want to hear the harmonies in context with the full band during preview.

**Acceptance Criteria:**
- [ ] Toggle button in the results section: "Vocals Only" / "With Band"
- [ ] When enabled, the mixed playback includes the instrumental backing (drums + bass + other stems)
- [ ] Volume slider for the instrumental backing level
- [ ] The instrumental stems come from Demucs (already separated — we just save the non-vocal stems)
- [ ] This is a playback-only feature — exported/downloaded files remain vocals + harmony only
- [ ] The toggle applies to all interval cards at once

### US-019: Save instrumental stems
**Description:** As a developer, I need the pipeline to save the non-vocal Demucs stems for instrumental backing.

**Acceptance Criteria:**
- [ ] During vocal separation, save the instrumental mix (sum of drums + bass + other) as a WAV
- [ ] Instrumental file served via `GET /api/files/{job_id}/instrumental.wav`
- [ ] If section cropping is active, the instrumental is cropped to match
- [ ] The instrumental file is included in the job results metadata

---

## Functional Requirements

- FR-1: The app must request microphone access via the Web Audio API / MediaRecorder API
- FR-2: Recording must capture mic input independently of playback audio (no feedback loop)
- FR-3: The recording must be saved as WAV and uploaded to the server as a new job input
- FR-4: The reference track must play during recording with a mute toggle (visual waveform stays active when muted)
- FR-5: Only one take is stored at a time — re-recording replaces the previous take
- FR-6: Pitch accuracy data must be computed server-side during the existing pitch correction step
- FR-7: Pitch data must be served as a JSON array aligned with the waveform timeline
- FR-8: The pitch color bar must use the design system colors (teal for in-tune, amber for slightly off, red for off)
- FR-9: Instrumental backing must be the sum of all non-vocal Demucs stems
- FR-10: Instrumental backing is playback-only — not included in exported files

---

## Non-Goals

- No multi-take management (only latest take kept)
- No BPM detection or metronome
- No latency compensation for recording (acceptable for a practice tool)
- No real-time pitch display during recording (only after processing)
- No instrumental backing in exported files
- No piano roll editing (Iteration 4)
- No chord detection (Iteration 5)

---

## Technical Considerations

### Recording
- Use `navigator.mediaDevices.getUserMedia({ audio: true })` for mic access
- `MediaRecorder` API to capture audio as WAV (or WebM → convert server-side)
- Playback of reference track via a separate `<audio>` element or WaveSurfer
- The mute toggle sets `volume = 0` on the playback element (waveform keeps scrolling via WaveSurfer)
- Recorded audio uploaded via the existing `POST /api/upload` endpoint

### Pitch Data
- During `pitch_correct_vocals()`, we already run WORLD analysis and compute deviations
- Extend the pipeline to collect and return the per-frame pitch data
- Store as JSON in the job's tmp directory
- Endpoint serves it from there
- Frontend renders as a `<canvas>` element synchronized with WaveSurfer's timeline

### Instrumental Backing
- In `separate_vocals()`, Demucs returns 4 stems: drums, bass, other, vocals
- Currently we only keep vocals. Change to also save: `instrumental = drums + bass + other`
- Save as `instrumental.wav` in the job's tmp directory
- Frontend loads it as a separate `<audio>` element, synced with the harmony playback
- Volume controlled independently via `HTMLAudioElement.volume`

### UI Changes
- **Recording mode**: New component `RecordingOverlay` that overlays the waveform area
- **Pitch bar**: New component `PitchBar` rendered below the waveform
- **Instrumental toggle**: Added to the `ResultsGrid` header area

### Design System Compliance
- Record button: Red LED indicator with glow (`--red` / `--red-glow`)
- Pulsing animation during recording (same pattern as processing pulse)
- Pitch bar colors: teal (in tune), amber (slightly off), red (off), `--bg-surface` (silence)
- Instrumental toggle: Same toggle switch component as pitch correction
- Mic level indicator: Horizontal VU-style bar using amber gradient

---

## Success Metrics

- User can record a vocal over the reference track and process it without leaving the browser
- Pitch color bar clearly shows where the vocal is off-pitch at a glance
- Instrumental backing makes it easy to judge if a harmony works in context with the full band
- No audio feedback loops during recording (clean mic capture)
