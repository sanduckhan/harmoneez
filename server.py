#!/usr/bin/env python3
"""
Harmoneez API server.
Run with: python server.py
"""

import asyncio
import json
import logging
import shutil
import tempfile
import time
import uuid
import zipfile
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path
from typing import Optional

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

import soundfile as sf
from fastapi import FastAPI, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from harmoneez.key_detection import detect_key, detect_key_changes, parse_key_string
from harmoneez.pipeline import run_pipeline

# ── Session persistence ───────────────────────────────────────────────────────

SESSIONS_DIR = Path.home() / ".harmoneez" / "sessions"
SESSIONS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Harmoneez API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Job management ────────────────────────────────────────────────────────────

@dataclass
class Job:
    id: str
    input_path: Path
    tmp_dir: Path
    filename: str
    duration: float = 0.0
    status: str = "uploaded"  # uploaded, processing, completed, failed
    created_at: float = field(default_factory=time.time)
    params: dict = field(default_factory=dict)
    result: Optional[dict] = None
    error: Optional[str] = None
    current_step: str = ""
    current_message: str = ""
    step_num: int = 0
    total_steps: int = 0
    websockets: list = field(default_factory=list)


jobs: dict[str, Job] = {}
processing_semaphore = asyncio.Semaphore(1)
loop: Optional[asyncio.AbstractEventLoop] = None


def save_session(job: Job, key: str = "", melody_count: int = 0):
    """Persist a completed session to disk."""
    session_dir = SESSIONS_DIR / job.id
    session_dir.mkdir(exist_ok=True)

    # Copy relevant files from tmp to session dir
    for f in job.tmp_dir.iterdir():
        if f.is_file():
            dest = session_dir / f.name
            if not dest.exists():
                shutil.copy2(str(f), str(dest))

    # Preserve existing recordings from a previous save
    existing_recordings = []
    meta_path = session_dir / "session.json"
    if meta_path.is_file():
        with open(meta_path) as f:
            existing_recordings = json.load(f).get("recordings", [])

    # Save metadata
    meta = {
        "id": job.id,
        "filename": job.filename,
        "duration": job.duration,
        "key": key,
        "melody_count": melody_count,
        "created_at": job.created_at,
        "result": job.result,
        "recordings": existing_recordings,
    }

    with open(session_dir / "session.json", "w") as f:
        json.dump(meta, f)


def load_sessions() -> list[dict]:
    """Load all saved sessions from disk."""

    sessions = []
    if not SESSIONS_DIR.exists():
        return sessions
    for d in sorted(SESSIONS_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        meta_path = d / "session.json"
        if meta_path.is_file():
            with open(meta_path) as f:
                meta = json.load(f)
                meta["session_dir"] = str(d)
                sessions.append(meta)
    return sessions


def restore_session(session_id: str) -> Job | None:
    """Restore a saved session into the active jobs dict."""
    session_dir = (SESSIONS_DIR / session_id).resolve()
    if not session_dir.is_relative_to(SESSIONS_DIR.resolve()):
        return None
    meta_path = session_dir / "session.json"
    if not meta_path.is_file():
        return None


    with open(meta_path) as f:
        meta = json.load(f)

    job = Job(
        id=meta["id"],
        input_path=session_dir / meta["filename"],
        tmp_dir=session_dir,
        filename=meta["filename"],
        duration=meta.get("duration", 0),
        status="completed",
        created_at=meta.get("created_at", time.time()),
        result=meta.get("result"),
    )
    jobs[job.id] = job
    return job


@app.on_event("startup")
async def startup():
    global loop
    loop = asyncio.get_event_loop()
    asyncio.create_task(cleanup_old_jobs())


async def cleanup_old_jobs():
    """Remove in-memory jobs older than 1 hour. Sessions on disk are kept."""
    while True:
        await asyncio.sleep(300)
        now = time.time()
        expired = [
            jid for jid, j in jobs.items()
            if now - j.created_at > 3600
            and not str(j.tmp_dir).startswith(str(SESSIONS_DIR))
        ]
        for jid in expired:
            job = jobs.pop(jid, None)
            if job:
                shutil.rmtree(str(job.tmp_dir), ignore_errors=True)


async def broadcast_progress(job: Job):
    """Send progress update to all connected WebSocket clients."""
    message = {
        "step": job.current_step,
        "message": job.current_message,
        "step_num": job.step_num,
        "total_steps": job.total_steps,
        "status": job.status,
    }
    if job.status == "completed" and job.result:
        message["result"] = job.result
    if job.status == "failed":
        message["error"] = job.error

    dead = []
    for ws in job.websockets:
        try:
            await ws.send_json(message)
        except Exception:
            dead.append(ws)
    for ws in dead:
        job.websockets.remove(ws)


# ── API Models ────────────────────────────────────────────────────────────────

class ProcessRequest(BaseModel):
    key: Optional[str] = None
    start: Optional[float] = None
    end: Optional[float] = None
    pitch_correct: bool = True
    intervals: str = "all"
    harmony_volume: float = 0.7
    skip_separation: bool = False
    harmony_in_tune: bool = False


class DownloadRequest(BaseModel):
    intervals: list[str]


class SaveRecordingRequest(BaseModel):
    vocal_job_id: str
    section_start: Optional[float] = None
    section_end: Optional[float] = None


def get_job(job_id: str) -> Job:
    """Get a job by ID or raise 404."""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/api/sessions")
async def list_sessions():
    """List all saved sessions."""
    sessions = load_sessions()
    return [
        {
            "id": s["id"],
            "filename": s["filename"],
            "duration": s.get("duration", 0),
            "key": s.get("key", ""),
            "melody_count": s.get("melody_count", 0),
            "created_at": s.get("created_at", 0),
        }
        for s in sessions
    ]


@app.post("/api/sessions/{session_id}/resume")
async def resume_session(session_id: str):
    """Resume a saved session — restores the job from disk without reprocessing."""
    job = restore_session(session_id)
    if not job:
        raise HTTPException(status_code=404, detail="Session not found")

    return {
        "job_id": job.id,
        "filename": job.filename,
        "duration": job.duration,
        "key": job.result.get("key", "") if job.result else "",
        "status": "completed",
    }


@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str):
    """Delete a saved session from disk."""
    session_dir = (SESSIONS_DIR / session_id).resolve()
    if not session_dir.is_relative_to(SESSIONS_DIR.resolve()):
        raise HTTPException(status_code=400, detail="Invalid session ID")
    if not session_dir.is_dir():
        raise HTTPException(status_code=404, detail="Session not found")
    shutil.rmtree(str(session_dir), ignore_errors=True)
    jobs.pop(session_id, None)
    return {"status": "deleted"}


UPLOAD_EXTENSIONS = {'.wav', '.mp3', '.webm', '.ogg'}


@app.post("/api/upload")
async def upload_file(file: UploadFile):
    """Upload a WAV/MP3/WebM file. Returns job_id and file info."""
    ext = Path(file.filename).suffix.lower()
    if ext not in UPLOAD_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported format '{ext}'. Use WAV, MP3, or WebM.")

    job_id = str(uuid.uuid4())[:8]
    tmp_dir = Path(tempfile.mkdtemp(prefix=f"harmoneez_{job_id}_"))
    input_path = tmp_dir / file.filename

    with open(input_path, "wb") as f:
        content = await file.read()
        f.write(content)

    # Convert webm/ogg to wav using ffmpeg
    if ext in ('.webm', '.ogg'):
        import subprocess
        wav_path = tmp_dir / (Path(file.filename).stem + '.wav')
        subprocess.run(
            ['ffmpeg', '-i', str(input_path), '-ar', '44100', '-ac', '1', str(wav_path)],
            capture_output=True, check=True,
        )
        input_path = wav_path

    # Get duration
    info = sf.info(str(input_path))

    job = Job(
        id=job_id,
        input_path=input_path,
        tmp_dir=tmp_dir,
        filename=file.filename,
        duration=info.duration,
    )
    jobs[job_id] = job

    return {
        "job_id": job_id,
        "filename": file.filename,
        "duration": info.duration,
        "sample_rate": info.samplerate,
    }


@app.get("/api/detect-key/{job_id}")
async def detect_key_endpoint(job_id: str):
    """Detect the key of the uploaded audio."""
    job = get_job(job_id)

    # Run key detection in a thread to not block
    def _detect():
        import numpy as np
        audio, sr = sf.read(str(job.input_path))
        if audio.ndim == 2:
            audio = np.mean(audio, axis=1)
        key, confidence, candidates = detect_key(audio.astype(np.float32), sr)
        has_change = detect_key_changes(audio.astype(np.float32), sr, key)
        return key, confidence, candidates, has_change

    key, confidence, candidates, has_change = await asyncio.to_thread(_detect)

    return {
        "key": key,
        "confidence": confidence,
        "candidates": [{"key": k, "confidence": c} for k, c in candidates],
        "has_key_change": has_change,
    }


class PrepareRequest(BaseModel):
    transpose: int = 0  # semitones to shift (-6 to +6)
    key: str = ''       # pre-detected key from key-select page


@app.post("/api/prepare/{job_id}")
async def prepare_file(job_id: str, req: PrepareRequest = PrepareRequest()):
    """Run vocal separation + pitch shift + melody extraction.
    Accepts transpose parameter for server-side pitch shifting."""
    job = get_job(job_id)
    if job.status == "processing":
        raise HTTPException(status_code=409, detail="Already processing")

    job.status = "processing"
    job.params = {"transpose": req.transpose, "key": req.key}
    asyncio.ensure_future(_run_prepare(job))
    return {"status": "processing", "job_id": job_id}


async def run_job(job: Job, runner):
    """Generic job runner with semaphore, progress broadcasting, and error handling."""
    async with processing_semaphore:
        def on_progress(step, message, step_num, total_steps):
            job.current_step = step
            job.current_message = message
            job.step_num = step_num
            job.total_steps = total_steps
            if loop:
                asyncio.run_coroutine_threadsafe(broadcast_progress(job), loop)

        try:
            result = await asyncio.to_thread(runner, on_progress)
            job.result = result
            job.status = "completed"
            return result
        except Exception as e:
            job.error = str(e) or repr(e)
            job.status = "failed"
        finally:
            await broadcast_progress(job)


async def _run_prepare(job: Job):
    """Run separation + optional transpose + melody extraction."""
    def runner(on_progress):
        from harmoneez.prepare import run_prepare
        return run_prepare(
            input_path=job.input_path,
            tmp_dir=job.tmp_dir,
            transpose=job.params.get("transpose", 0),
            key=job.params.get("key", ""),
            duration=job.duration,
            on_progress=on_progress,
        )

    result = await run_job(job, runner)
    if result:
        save_session(job, key=result.get("key", ""), melody_count=result.get("melody_count", 0))


@app.post("/api/process/{job_id}")
async def process_file(job_id: str, req: ProcessRequest):
    """Start processing. Progress is streamed via WebSocket."""
    job = get_job(job_id)
    if job.status == "processing":
        raise HTTPException(status_code=409, detail="Already processing")

    # Validate key if provided
    if req.key:
        try:
            req.key = parse_key_string(req.key)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    job.status = "processing"
    job.params = req.model_dump()

    # Run pipeline in a background thread
    asyncio.ensure_future(_run_pipeline(job))

    return {"status": "processing", "job_id": job_id}


async def _run_pipeline(job: Job):
    """Run the harmony generation pipeline."""
    def runner(on_progress):
        params = job.params
        logger.info("Pipeline input: %s params=%s", job.input_path.name, params)

        result = run_pipeline(
            input_path=job.input_path,
            key=params.get("key"),
            start=params.get("start"),
            end=params.get("end"),
            pitch_correct=params.get("pitch_correct", True),
            intervals=params.get("intervals", "all"),
            harmony_volume=params.get("harmony_volume", 0.7),
            output_dir=job.tmp_dir,
            on_progress=on_progress,
            skip_separation=params.get("skip_separation", False),
            harmony_in_tune=params.get("harmony_in_tune", False),
        )

        # Convert file paths to relative URLs
        for f in result["files"]:
            harm_name = Path(f["harmony_path"]).name
            mixed_name = Path(f["mixed_path"]).name
            f["harmony_url"] = f"/api/files/{job.id}/{harm_name}"
            f["mixed_url"] = f"/api/files/{job.id}/{mixed_name}"

        if result.get("corrected_path"):
            corr_name = Path(result["corrected_path"]).name
            result["corrected_url"] = f"/api/files/{job.id}/{corr_name}"

        if result.get("instrumental_path"):
            inst_name = Path(result["instrumental_path"]).name
            result["instrumental_url"] = f"/api/files/{job.id}/{inst_name}"

        return result

    await run_job(job, runner)


@app.get("/api/results/{job_id}")
async def get_results(job_id: str):
    """Get processing results."""
    job = get_job(job_id)

    return {
        "status": job.status,
        "result": job.result,
        "error": job.error,
    }


@app.get("/api/melody/{job_id}")
async def get_melody_data(job_id: str):
    """Serve extracted melody notes as JSON for pitch guide."""
    job = get_job(job_id)

    melody_file = job.tmp_dir / "melody_data.json"
    if not melody_file.is_file():
        raise HTTPException(status_code=404, detail="Melody data not available")


    with open(melody_file) as f:
        return json.load(f)


@app.get("/api/pitch-contour/{job_id}")
async def get_pitch_contour(job_id: str):
    """Serve frame-level pitch contour (MIDI values) for canvas display."""
    job = get_job(job_id)
    f = job.tmp_dir / "pitch_contour.json"
    if not f.is_file():
        raise HTTPException(status_code=404, detail="Pitch contour not available")
    with open(f) as fh:
        return json.load(fh)


@app.get("/api/amplitude/{job_id}")
async def get_amplitude(job_id: str):
    """Serve vocal amplitude envelope for visual debugging."""
    job = get_job(job_id)
    amp_file = job.tmp_dir / "amplitude.json"
    if not amp_file.is_file():
        raise HTTPException(status_code=404, detail="Amplitude data not available")
    with open(amp_file) as f:
        return json.load(f)


@app.get("/api/pitch-data/{job_id}")
async def get_pitch_data(job_id: str):
    """Serve pitch accuracy data as JSON."""
    job = get_job(job_id)

    pitch_file = job.tmp_dir / "pitch_data.json"
    if not pitch_file.is_file():
        raise HTTPException(status_code=404, detail="Pitch data not available")


    with open(pitch_file) as f:
        return json.load(f)


@app.get("/api/files/{job_id}/{filename}")
async def get_file(job_id: str, filename: str):
    """Serve a generated audio file."""
    job = get_job(job_id)

    file_path = (job.tmp_dir / filename).resolve()
    if not file_path.is_relative_to(job.tmp_dir.resolve()):
        raise HTTPException(status_code=400, detail="Invalid filename")
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(str(file_path), media_type="audio/wav", filename=filename)


@app.post("/api/download/{job_id}")
async def download_zip(job_id: str, req: DownloadRequest):
    """Download selected intervals as a ZIP file."""
    job = jobs.get(job_id)
    if not job or not job.result:
        raise HTTPException(status_code=404, detail="Job not found or not completed")

    buf = BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for f in job.result["files"]:
            if f["interval"] in req.intervals:
                harm_path = Path(f["harmony_path"])
                mixed_path = Path(f["mixed_path"])
                if harm_path.is_file():
                    zf.write(harm_path, harm_path.name)
                if mixed_path.is_file():
                    zf.write(mixed_path, mixed_path.name)

        # Include corrected vocal
        if job.result.get("corrected_path"):
            corr_path = Path(job.result["corrected_path"])
            if corr_path.is_file():
                zf.write(corr_path, corr_path.name)

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=harmoneez_{job_id}.zip"},
    )


# ── Recording persistence ────────────────────────────────────────────────────

def _persist_recording(
    session_dir: Path, rec_id: str, vocal_job: Job,
    section_start: float | None, section_end: float | None,
) -> dict:
    """Copy recording files to session dir and return metadata entry. (sync, blocking)"""
    rec_dir = session_dir / "recordings" / rec_id
    rec_dir.mkdir(parents=True, exist_ok=True)

    harmonies = []
    vocal_file = None
    corrected_file = None

    for f_info in vocal_job.result.get("files", []):
        for key_name in ("harmony_path", "mixed_path"):
            src = Path(f_info[key_name])
            if src.is_file():
                dest_name = src.name
                if dest_name.startswith("recording_"):
                    dest_name = dest_name[len("recording_"):]
                shutil.copy2(str(src), str(rec_dir / dest_name))
                if key_name == "harmony_path":
                    harmonies.append({"interval": f_info["interval"], "harmony_file": dest_name})
                elif harmonies:
                    harmonies[-1]["mixed_file"] = dest_name

    if vocal_job.result.get("corrected_path"):
        src = Path(vocal_job.result["corrected_path"])
        if src.is_file():
            corrected_file = "corrected.wav"
            shutil.copy2(str(src), str(rec_dir / corrected_file))

    if vocal_job.input_path.is_file():
        vocal_file = "vocal.wav"
        shutil.copy2(str(vocal_job.input_path), str(rec_dir / vocal_file))

    try:
        info = sf.info(str(rec_dir / vocal_file)) if vocal_file else None
        rec_duration = info.duration if info else 0.0
    except Exception:
        rec_duration = 0.0

    recording = {
        "id": rec_id,
        "created_at": time.time(),
        "duration": rec_duration,
        "section_start": section_start,
        "section_end": section_end,
        "vocal_file": vocal_file,
        "corrected_file": corrected_file,
        "harmonies": harmonies,
    }

    # Update session.json
    meta_path = session_dir / "session.json"
    with open(meta_path) as f:
        meta = json.load(f)
    meta.setdefault("recordings", []).append(recording)
    with open(meta_path, "w") as f:
        json.dump(meta, f)

    return recording


@app.post("/api/sessions/{session_id}/recordings")
async def save_recording(session_id: str, req: SaveRecordingRequest):
    """Save a recording and its generated harmonies to the song session."""
    session_dir = (SESSIONS_DIR / session_id).resolve()
    if not session_dir.is_relative_to(SESSIONS_DIR.resolve()) or not session_dir.is_dir():
        raise HTTPException(status_code=404, detail="Session not found")

    vocal_job = jobs.get(req.vocal_job_id)
    if not vocal_job or not vocal_job.result:
        raise HTTPException(status_code=404, detail="Vocal job not found or not completed")

    rec_id = f"rec_{uuid.uuid4().hex[:6]}"

    # File copies are blocking I/O — run off the event loop
    await asyncio.get_event_loop().run_in_executor(
        None, _persist_recording,
        session_dir, rec_id, vocal_job, req.section_start, req.section_end,
    )

    return {"recording_id": rec_id}


def _recording_urls(session_id: str, rec: dict) -> dict:
    """Add resolved URLs to a recording entry."""
    rec_id = rec["id"]
    base = f"/api/sessions/{session_id}/recordings/{rec_id}"
    result = {
        "id": rec_id,
        "created_at": rec["created_at"],
        "duration": rec.get("duration", 0),
        "section_start": rec.get("section_start"),
        "section_end": rec.get("section_end"),
        "vocal_url": f"{base}/{rec['vocal_file']}" if rec.get("vocal_file") else None,
        "corrected_url": f"{base}/{rec['corrected_file']}" if rec.get("corrected_file") else None,
        "harmonies": [
            {
                "interval": h["interval"],
                "harmony_url": f"{base}/{h['harmony_file']}",
                "mixed_url": f"{base}/{h['mixed_file']}",
            }
            for h in rec.get("harmonies", [])
        ],
    }
    return result


@app.get("/api/sessions/{session_id}/recordings")
async def list_recordings(session_id: str):
    """List all recordings for a song session."""
    session_dir = (SESSIONS_DIR / session_id).resolve()
    if not session_dir.is_relative_to(SESSIONS_DIR.resolve()):
        raise HTTPException(status_code=404, detail="Session not found")

    meta_path = session_dir / "session.json"
    if not meta_path.is_file():
        raise HTTPException(status_code=404, detail="Session not found")

    with open(meta_path) as f:
        meta = json.load(f)

    recordings = meta.get("recordings", [])
    return [_recording_urls(session_id, r) for r in recordings]


@app.get("/api/sessions/{session_id}/recordings/{recording_id}/{filename}")
async def get_recording_file(session_id: str, recording_id: str, filename: str):
    """Serve an audio file from a recording."""
    session_dir = (SESSIONS_DIR / session_id).resolve()
    if not session_dir.is_relative_to(SESSIONS_DIR.resolve()):
        raise HTTPException(status_code=400, detail="Invalid session")

    file_path = (session_dir / "recordings" / recording_id / filename).resolve()
    if not file_path.is_relative_to(session_dir.resolve()):
        raise HTTPException(status_code=400, detail="Invalid path")
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(str(file_path), media_type="audio/wav", filename=filename)


@app.post("/api/sessions/{session_id}/recordings/{recording_id}/download")
async def download_recording_zip(session_id: str, recording_id: str):
    """Download all files from a recording as a ZIP."""
    session_dir = (SESSIONS_DIR / session_id).resolve()
    if not session_dir.is_relative_to(SESSIONS_DIR.resolve()):
        raise HTTPException(status_code=404, detail="Session not found")

    rec_dir = (session_dir / "recordings" / recording_id).resolve()
    if not rec_dir.is_relative_to(session_dir.resolve()) or not rec_dir.is_dir():
        raise HTTPException(status_code=404, detail="Recording not found")

    buf = BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for f in rec_dir.iterdir():
            if f.is_file() and f.suffix == '.wav':
                zf.write(f, f.name)

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=harmoneez_{recording_id}.zip"},
    )


@app.delete("/api/sessions/{session_id}/recordings/{recording_id}")
async def delete_recording(session_id: str, recording_id: str):
    """Delete a recording and its files."""
    session_dir = (SESSIONS_DIR / session_id).resolve()
    if not session_dir.is_relative_to(SESSIONS_DIR.resolve()):
        raise HTTPException(status_code=404, detail="Session not found")

    meta_path = session_dir / "session.json"
    if not meta_path.is_file():
        raise HTTPException(status_code=404, detail="Session not found")

    # Remove from metadata
    with open(meta_path) as f:
        meta = json.load(f)

    recordings = meta.get("recordings", [])
    meta["recordings"] = [r for r in recordings if r["id"] != recording_id]

    with open(meta_path, "w") as f:
        json.dump(meta, f)

    # Remove files
    rec_dir = session_dir / "recordings" / recording_id
    if rec_dir.is_dir():
        shutil.rmtree(str(rec_dir), ignore_errors=True)

    return {"status": "deleted"}


# ── WebSocket ─────────────────────────────────────────────────────────────────

@app.websocket("/ws/{job_id}")
async def websocket_progress(websocket: WebSocket, job_id: str):
    """Real-time progress updates for a processing job."""
    await websocket.accept()

    job = jobs.get(job_id)
    if not job:
        await websocket.send_json({"error": "Job not found"})
        await websocket.close()
        return

    job.websockets.append(websocket)

    # Send current state immediately (for late-connecting clients)
    await websocket.send_json({
        "step": job.current_step,
        "message": job.current_message,
        "step_num": job.step_num,
        "total_steps": job.total_steps,
        "status": job.status,
    })

    try:
        # Keep alive until client disconnects or job completes
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        if websocket in job.websockets:
            job.websockets.remove(websocket)


# ── Serve uploaded audio for waveform display ─────────────────────────────────

@app.get("/api/audio/{job_id}")
async def get_uploaded_audio(job_id: str):
    """Serve the original uploaded audio file (for waveform display)."""
    job = get_job(job_id)

    return FileResponse(str(job.input_path), media_type="audio/wav", filename=job.filename)


# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
