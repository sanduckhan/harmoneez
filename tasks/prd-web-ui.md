# PRD: Web UI for Harmony Generation (Iteration 3)

## Introduction

Replace the CLI workflow with a local web interface where the user can upload a song, select a section on the waveform, generate all harmony variants, compare them, and download the ones they like. The app runs locally on the user's laptop — no cloud deployment.

This is split into two sub-iterations:
- **3a**: Core workflow (upload → process → compare → download)
- **3b**: In-browser recording, pitch comparison overlay, original mix toggle

---

## Iteration 3a — Core Web UI

### Goals

- Local web app: FastAPI backend + React frontend
- Upload WAV/MP3, display waveform, select section by dragging on waveform
- Detect key (with override), generate all 8 interval types
- Sequential playback of each variant with A/B comparison
- Download selected variants

### User Stories

#### US-001: FastAPI backend wrapping the CLI pipeline
**Description:** As a developer, I need an API that exposes the harmonize pipeline so the frontend can call it.

**Acceptance Criteria:**
- [ ] `POST /api/upload` accepts a WAV/MP3 file, returns a job ID
- [ ] `POST /api/process` accepts job ID + parameters (key, start, end, pitch correction on/off), starts processing
- [ ] `GET /api/status/{job_id}` returns processing progress (which step is running)
- [ ] `GET /api/results/{job_id}` returns list of generated files with download URLs
- [ ] `GET /api/files/{job_id}/{filename}` serves individual audio files
- [ ] Processing runs in a background thread/process so the API doesn't block
- [ ] All existing CLI logic reused — no duplication of pipeline code

#### US-002: React frontend scaffold
**Description:** As a developer, I need a React + TypeScript app that communicates with the backend.

**Acceptance Criteria:**
- [ ] Create React app with TypeScript in a `frontend/` directory
- [ ] Proxy API calls to FastAPI backend (port 8000)
- [ ] Clean, minimal layout — single page app
- [ ] Responsive but desktop-first (this is a studio tool)

#### US-003: File upload
**Description:** As a user, I want to drag-and-drop a song file so I can start working with it.

**Acceptance Criteria:**
- [ ] Drag-and-drop zone on the main page
- [ ] Also accepts click-to-browse
- [ ] Shows file name and duration after upload
- [ ] Validates format (WAV/MP3 only)
- [ ] Shows upload progress for large files

#### US-004: Waveform display
**Description:** As a user, I want to see the waveform of my uploaded song so I can visually identify sections.

**Acceptance Criteria:**
- [ ] Display full waveform using WaveSurfer.js after upload
- [ ] Play/pause button
- [ ] Playhead cursor showing current position
- [ ] Time labels on the waveform axis

#### US-005: Section selection on waveform
**Description:** As a user, I want to click and drag on the waveform to select the section I want to harmonize.

**Acceptance Criteria:**
- [ ] Click and drag to create a highlighted region on the waveform
- [ ] Region is resizable by dragging edges
- [ ] Start/end times displayed and editable as text fields (for precision)
- [ ] Playback can be limited to the selected region (loop mode)
- [ ] If no region selected, process the full song

#### US-006: Key detection and override
**Description:** As a user, I want to see the detected key and change it if it's wrong.

**Acceptance Criteria:**
- [ ] After upload, auto-detect key and display it (e.g. "Detected: Eb minor (0.88)")
- [ ] Dropdown to override with any key (all 24 major/minor keys)
- [ ] Key detection runs on the full uploaded file
- [ ] Show top 3 candidates with confidence scores

#### US-007: Processing with progress
**Description:** As a user, I want to see progress while the tool processes my song.

**Acceptance Criteria:**
- [ ] "Generate Harmonies" button starts processing
- [ ] Progress indicator showing current step (isolating vocals, correcting pitch, extracting melody, generating harmonies...)
- [ ] Estimated time remaining or step count (e.g. "Step 3/6")
- [ ] Cannot start a new job while one is processing

#### US-008: Results comparison
**Description:** As a user, I want to listen to each harmony variant and compare them.

**Acceptance Criteria:**
- [ ] After processing, show a list/grid of all 8 interval types
- [ ] Each variant has a play button (plays the mixed version)
- [ ] Only one variant plays at a time (clicking another stops the current one)
- [ ] Volume slider per variant
- [ ] Visual indicator of which variant is currently playing
- [ ] Option to play harmony-only (without lead vocal)

#### US-009: Download selected variants
**Description:** As a user, I want to download the harmony files I like.

**Acceptance Criteria:**
- [ ] Checkbox on each variant to select it
- [ ] "Download Selected" button downloads a ZIP of selected files
- [ ] Each download includes both harmony-only and mixed versions
- [ ] Also include the corrected vocal in the download

### Non-Goals (deferred to 3b)

- No in-browser recording / microphone input
- No pitch comparison overlay
- No original mix (instruments) playback toggle
- No real-time multi-track toggle (play one variant at a time for now)

### Technical Considerations

**Project structure (refactored into a package):**
```
harmoneez/
├── harmoneez/              # Python package (core logic)
│   ├── __init__.py
│   ├── pipeline.py         # Main orchestrator with progress callbacks
│   ├── separation.py       # Demucs vocal isolation
│   ├── key_detection.py    # Essentia key detection
│   ├── pitch_correction.py # WORLD pitch correction
│   ├── melody.py           # Basic Pitch melody extraction
│   ├── harmony.py          # Harmony generation (music theory)
│   ├── renderer.py         # WORLD vocoder rendering
│   ├── mixer.py            # Humanization + stereo mixing
│   └── utils.py            # parse_time, parse_key_string, constants
├── server.py               # FastAPI backend + WebSocket
├── cli.py                  # CLI entry point (thin wrapper around pipeline)
├── frontend/               # React app
│   ├── src/
│   ├── package.json
│   └── ...
├── requirements.txt
└── README.md
```

**Backend architecture:**

- **FastAPI** with WebSocket for real-time progress
- **Job management:** Each upload gets a UUID. Jobs stored in a dict in memory (no database for local-only). Temp directory per job, auto-cleaned after 1 hour.
- **Concurrency:** `asyncio.to_thread()` to run the heavy pipeline in a thread pool so the event loop stays responsive for WebSocket messages
- **File serving:** FastAPI `StaticFiles` mount for generated audio files. Frontend fetches them as regular audio URLs.
- **No auth** — local only. No CORS issues with frontend proxy.

**WebSocket progress flow:**
```
Client connects to ws://localhost:8000/ws/{job_id}
Server sends: {"step": "vocals", "message": "Isolating vocals...", "step_num": 1, "total_steps": 6}
Server sends: {"step": "key", "message": "Detected Eb minor (0.88)", "step_num": 2, ...}
...
Server sends: {"step": "done", "files": [{name, interval, harmony_url, mixed_url}, ...]}
```

**API endpoints:**
```
POST /api/upload              → upload WAV/MP3, returns {job_id, duration, waveform_url}
POST /api/process/{job_id}    → start processing with params {key, start, end, pitch_correct}
GET  /api/status/{job_id}     → current step + progress
GET  /api/results/{job_id}    → list of generated files
GET  /api/files/{job_id}/{fn} → serve individual audio file
WS   /ws/{job_id}             → real-time progress stream
```

**Frontend:**
- **React + TypeScript** with Vite
- **WaveSurfer.js** for waveform display + region selection
- **Web Audio API** for playback (native, no Tone.js needed for sequential play)
- **Tailwind CSS** for styling
- Simple `fetch` + native `WebSocket` — no heavy state management

**Running locally:**
```bash
# Terminal 1: backend
python server.py  # starts FastAPI on port 8000

# Terminal 2: frontend
cd frontend && npm run dev  # starts Vite dev server on port 5173
```

Or a single script that starts both.

### Success Metrics

- User can go from upload to listening to all 8 harmony variants in under 3 minutes
- Section selection is intuitive — no need to type timestamps
- A/B comparison between variants is seamless (one click to switch)

---

## Iteration 3b — Recording, Pitch View & Full Mix

### Goals

- Record vocals in-browser over the original track
- See pitch accuracy overlay after processing
- Toggle instrumental backing track behind harmonies

### User Stories

#### US-010: In-browser vocal recording
**Description:** As a user, I want to sing along with the original track and record my voice directly in the browser.

**Acceptance Criteria:**
- [ ] Microphone access via Web Audio API
- [ ] Play the original track while recording mic input
- [ ] Toggle original track audio on/off (keep waveform visual even when muted)
- [ ] Recording saved as WAV
- [ ] Can re-record multiple takes
- [ ] Use the recording as input for the harmony pipeline (same as uploading a file)

#### US-011: Pitch accuracy overlay
**Description:** As a user, I want to see where I'm singing in tune vs off-pitch compared to the detected melody.

**Acceptance Criteria:**
- [ ] After processing, overlay pitch data on the waveform
- [ ] Show detected pitch (actual) vs nearest scale degree (target)
- [ ] Color coding: green = in tune (< 20 cents off), yellow = slightly off (20-40 cents), red = significantly off (> 40 cents)
- [ ] Hover to see exact cent deviation
- [ ] This uses the same pYIN/WORLD analysis we already run for pitch correction

#### US-012: Instrumental backing toggle
**Description:** As a user, I want to hear the harmonies in context with the full band, not just isolated vocals.

**Acceptance Criteria:**
- [ ] Toggle button: "Vocals only" / "With instruments"
- [ ] When enabled, mix the harmony with the original track minus vocals (Demucs already gives us this — it's the sum of drums + bass + other stems)
- [ ] Volume control for the instrumental backing

### Non-Goals

- No MIDI export (Iteration 7)
- No piano roll editing (Iteration 4)
- No chord detection (Iteration 5)

### Technical Considerations

- In-browser recording uses `MediaRecorder` API
- Instrumental backing = sum of non-vocal Demucs stems (already separated, just need to save them)
- Pitch overlay data can be computed server-side and sent as JSON (array of {time, actual_hz, target_hz, deviation_cents})
