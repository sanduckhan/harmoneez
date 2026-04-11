#!/usr/bin/env python3
"""
Harmoneez API server.
Run with: python server.py
"""

import asyncio
import json
import shutil
import tempfile
import time
import uuid
import zipfile
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path
from typing import Optional

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
        dest = session_dir / f.name
        if not dest.exists():
            shutil.copy2(str(f), str(dest))

    # Save metadata
    meta = {
        "id": job.id,
        "filename": job.filename,
        "duration": job.duration,
        "key": key,
        "melody_count": melody_count,
        "created_at": job.created_at,
        "result": job.result,
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


class DownloadRequest(BaseModel):
    intervals: list[str]


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
            job.error = str(e)
            job.status = "failed"
        finally:
            await broadcast_progress(job)


async def _run_prepare(job: Job):
    """Run separation + key detection + optional transpose + melody extraction."""
    def runner(on_progress):
        from harmoneez.separation import separate_vocals
        from harmoneez.pitch_shift import pitch_shift_librosa
        from harmoneez.note_segmentation import f0_contour_to_notes
        import numpy as np
        import pyworld as pw

        transpose = job.params.get("transpose", 0)
        key_name = job.params.get("key", "")
        total_steps = 5 if transpose != 0 else 2

        step = 0

        # Step 1: Separate vocals (the long one)
        step += 1
        duration_s = job.duration
        estimate = max(30, int(duration_s * 0.35))
        on_progress("separating", f"Isolating vocals... (~{estimate}s)", step, total_steps)
        vocals_audio, instrumental_audio, sr = separate_vocals(job.input_path, job.tmp_dir)

        # Steps 2-4: Pitch shift if transpose != 0
        if transpose != 0:
            # Step 2: Analyze vocal pitch (WORLD harvest + cheaptrick + d4c)
            step += 1
            on_progress("transposing", "Analyzing vocal pitch...", step, total_steps)
            audio_f64 = vocals_audio.astype(np.float64)
            f0_v, ta_v = pw.harvest(audio_f64, sr, f0_floor=65.0, f0_ceil=1000.0)
            sp_v = pw.cheaptrick(audio_f64, f0_v, ta_v, sr)
            ap_v = pw.d4c(audio_f64, f0_v, ta_v, sr)

            # Step 3: Transpose vocals (synthesis)
            step += 1
            on_progress("transposing", "Transposing vocals...", step, total_steps)
            f0_shifted = f0_v * (2.0 ** (transpose / 12.0))
            vocals_shifted = pw.synthesize(f0_shifted, sp_v, ap_v, sr)
            if len(vocals_shifted) > len(vocals_audio):
                vocals_shifted = vocals_shifted[:len(vocals_audio)]
            elif len(vocals_shifted) < len(vocals_audio):
                vocals_shifted = np.pad(vocals_shifted, (0, len(vocals_audio) - len(vocals_shifted)))
            vocals_audio = vocals_shifted.astype(np.float32)

            # Step 4: Transpose instrumental
            step += 1
            on_progress("transposing", "Transposing instrumental...", step, total_steps)
            instrumental_audio = pitch_shift_librosa(instrumental_audio, sr, transpose)

            sf.write(str(job.tmp_dir / "vocals.wav"), vocals_audio, sr)
            sf.write(str(job.tmp_dir / "instrumental.wav"), instrumental_audio, sr)
            # key_name is already the transposed key from the frontend — don't transpose again

        # Always create full mix from stems
        full_mix = vocals_audio + instrumental_audio
        max_val = np.max(np.abs(full_mix))
        if max_val > 1.0:
            full_mix = full_mix / max_val
        sf.write(str(job.tmp_dir / "full_mix.wav"), full_mix, sr)

        # Final step: Extract melody
        step += 1
        on_progress("extracting_melody", "Extracting melody...", step, total_steps)

        audio_f64 = vocals_audio.astype(np.float64)
        f0, timeaxis = pw.harvest(audio_f64, sr, f0_floor=65.0, f0_ceil=1000.0)

        world_notes = f0_contour_to_notes(f0, timeaxis, vocals_audio, sr)

        with open(job.tmp_dir / "melody_data.json", 'w') as f:
            json.dump(world_notes, f)

        # Pitch contour: frame-level F0 in MIDI (null for unvoiced)
        pitch_contour = []
        for i in range(len(f0)):
            if f0[i] < 1.0:
                pitch_contour.append(None)
            else:
                midi = 12 * np.log2(f0[i] / 440.0) + 69
                pitch_contour.append(round(float(midi), 2))

        frame_duration = float(timeaxis[1] - timeaxis[0]) if len(timeaxis) > 1 else 0.005

        with open(job.tmp_dir / "pitch_contour.json", 'w') as f:
            json.dump({"frame_duration": frame_duration, "contour": pitch_contour}, f)

        # Amplitude envelope (RMS at ~100fps)
        hop = sr // 100
        envelope = []
        for i in range(0, len(vocals_audio), hop):
            chunk = vocals_audio[i:i+hop]
            rms = float(np.sqrt(np.mean(chunk**2)))
            envelope.append(round(rms, 5))
        with open(job.tmp_dir / "amplitude.json", 'w') as f:
            json.dump({"sr": sr, "hop": hop, "envelope": envelope}, f)

        on_progress("done", "Ready!", total_steps, total_steps)

        return {
            "key": key_name,
            "melody_count": len(world_notes),
            "duration": len(vocals_audio) / sr,
        }

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
