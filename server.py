#!/usr/bin/env python3
"""
Harmoneez API server.
Run with: python server.py
"""

import asyncio
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
from harmoneez.utils import INTERVAL_TYPES, SUPPORTED_EXTENSIONS

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
processing_semaphore = asyncio.Semaphore(1)  # limit to 1 concurrent job
loop: Optional[asyncio.AbstractEventLoop] = None


@app.on_event("startup")
async def startup():
    global loop
    loop = asyncio.get_event_loop()
    asyncio.create_task(cleanup_old_jobs())


async def cleanup_old_jobs():
    """Remove jobs older than 1 hour every 5 minutes."""
    while True:
        await asyncio.sleep(300)
        now = time.time()
        expired = [jid for jid, j in jobs.items() if now - j.created_at > 3600]
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


# ── Endpoints ─────────────────────────────────────────────────────────────────

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
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

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


@app.post("/api/prepare/{job_id}")
async def prepare_file(job_id: str):
    """Run vocal separation + key detection + melody extraction only.
    Used for the practice flow: prepare the reference track before recording."""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status == "processing":
        raise HTTPException(status_code=409, detail="Already processing")

    job.status = "processing"
    asyncio.ensure_future(_run_prepare(job))
    return {"status": "processing", "job_id": job_id}


async def _run_prepare(job: Job):
    """Run only separation + key detection + melody extraction."""
    async with processing_semaphore:
        def on_progress(step, message, step_num, total_steps):
            job.current_step = step
            job.current_message = message
            job.step_num = step_num
            job.total_steps = total_steps
            if loop:
                asyncio.run_coroutine_threadsafe(broadcast_progress(job), loop)

        def _run():
            from harmoneez.separation import separate_vocals
            from harmoneez.key_detection import detect_key
            from harmoneez.melody import extract_melody
            import json
            import soundfile as sf_local

            on_progress("separating", "Isolating vocals...", 1, 3)
            vocals_audio, instrumental_audio, sr = separate_vocals(job.input_path, job.tmp_dir)
            on_progress("separating", f"Vocal track: {len(vocals_audio)/sr:.1f}s", 1, 3)

            on_progress("detecting_key", "Detecting key...", 2, 3)
            key_name, confidence, candidates = detect_key(vocals_audio, sr)

            on_progress("extracting_melody", "Extracting melody...", 3, 3)
            vocals_path = job.tmp_dir / "vocals.wav"
            melody_notes = extract_melody(vocals_path)

            melody_json = [
                {"start_sec": s, "end_sec": e, "midi_pitch": p, "velocity": round(v, 3)}
                for s, e, p, v in melody_notes
            ]
            with open(job.tmp_dir / "melody_data.json", 'w') as f:
                json.dump(melody_json, f)

            on_progress("done", "Ready!", 3, 3)

            return {
                "key": key_name,
                "confidence": confidence,
                "candidates": [{"key": k, "confidence": c} for k, c in candidates],
                "melody_count": len(melody_notes),
                "duration": len(vocals_audio) / sr,
            }

        try:
            result = await asyncio.to_thread(_run)
            job.result = result
            job.status = "completed"
        except Exception as e:
            job.error = str(e)
            job.status = "failed"

        await broadcast_progress(job)


@app.post("/api/process/{job_id}")
async def process_file(job_id: str, req: ProcessRequest):
    """Start processing. Progress is streamed via WebSocket."""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
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
    """Run the pipeline in a thread with progress broadcasting."""
    async with processing_semaphore:
        def on_progress(step, message, step_num, total_steps):
            job.current_step = step
            job.current_message = message
            job.step_num = step_num
            job.total_steps = total_steps
            if loop:
                asyncio.run_coroutine_threadsafe(broadcast_progress(job), loop)

        def _run():
            params = job.params
            return run_pipeline(
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

        try:
            result = await asyncio.to_thread(_run)

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

            job.result = result
            job.status = "completed"
        except Exception as e:
            job.error = str(e)
            job.status = "failed"

        # Final broadcast
        await broadcast_progress(job)


@app.get("/api/results/{job_id}")
async def get_results(job_id: str):
    """Get processing results."""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return {
        "status": job.status,
        "result": job.result,
        "error": job.error,
    }


@app.get("/api/melody/{job_id}")
async def get_melody_data(job_id: str):
    """Serve extracted melody notes as JSON for pitch guide."""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    melody_file = job.tmp_dir / "melody_data.json"
    if not melody_file.is_file():
        raise HTTPException(status_code=404, detail="Melody data not available")

    import json
    with open(melody_file) as f:
        return json.load(f)


@app.get("/api/pitch-data/{job_id}")
async def get_pitch_data(job_id: str):
    """Serve pitch accuracy data as JSON."""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    pitch_file = job.tmp_dir / "pitch_data.json"
    if not pitch_file.is_file():
        raise HTTPException(status_code=404, detail="Pitch data not available")

    import json
    with open(pitch_file) as f:
        return json.load(f)


@app.get("/api/files/{job_id}/{filename}")
async def get_file(job_id: str, filename: str):
    """Serve a generated audio file."""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    file_path = job.tmp_dir / filename
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
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return FileResponse(str(job.input_path), media_type="audio/wav", filename=job.filename)


# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
