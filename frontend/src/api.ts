import type { UploadResult, KeyDetectionResult, PipelineResult, MelodyNote, RecordingInfo } from './types';

const BASE = '';

export async function uploadFile(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/api/upload`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`Upload failed: ${res.statusText}`);
  return res.json();
}

export async function detectKey(jobId: string): Promise<KeyDetectionResult> {
  const res = await fetch(`${BASE}/api/detect-key/${jobId}`);
  if (!res.ok) throw new Error(`Key detection failed: ${res.statusText}`);
  return res.json();
}

export async function startProcessing(jobId: string, params: {
  key?: string;
  start?: number;
  end?: number;
  pitch_correct?: boolean;
  intervals?: string;
  harmony_volume?: number;
  skip_separation?: boolean;
  harmony_in_tune?: boolean;
}): Promise<void> {
  const res = await fetch(`${BASE}/api/process/${jobId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`Processing failed: ${res.statusText}`);
}

export async function getResults(jobId: string): Promise<{ status: string; result: PipelineResult | null; error: string | null }> {
  const res = await fetch(`${BASE}/api/results/${jobId}`);
  if (!res.ok) throw new Error(`Results fetch failed: ${res.statusText}`);
  return res.json();
}

export async function downloadZip(jobId: string, intervals: string[]): Promise<void> {
  const res = await fetch(`${BASE}/api/download/${jobId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intervals }),
  });
  if (!res.ok) throw new Error(`Download failed: ${res.statusText}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `harmoneez_${jobId}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

export function audioUrl(jobId: string): string {
  return `${BASE}/api/audio/${jobId}`;
}

export interface SessionInfo {
  id: string;
  filename: string;
  duration: number;
  key: string;
  melody_count: number;
  created_at: number;
}

export async function getSessions(): Promise<SessionInfo[]> {
  const res = await fetch(`${BASE}/api/sessions`);
  if (!res.ok) return [];
  return res.json();
}

export async function resumeSession(sessionId: string): Promise<{ job_id: string; filename: string; duration: number; key: string }> {
  const res = await fetch(`${BASE}/api/sessions/${sessionId}/resume`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to resume session');
  return res.json();
}

export async function deleteSession(sessionId: string): Promise<void> {
  await fetch(`${BASE}/api/sessions/${sessionId}`, { method: 'DELETE' });
}

export async function prepareReference(jobId: string, transpose: number = 0, key: string = ''): Promise<void> {
  const res = await fetch(`${BASE}/api/prepare/${jobId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transpose, key }),
  });
  if (!res.ok) throw new Error(`Prepare failed: ${res.statusText}`);
}

export interface AmplitudeData {
  sr: number;
  hop: number;
  envelope: number[];
}

export async function getAmplitudeData(jobId: string): Promise<AmplitudeData | null> {
  const res = await fetch(`${BASE}/api/amplitude/${jobId}`);
  if (!res.ok) return null;
  return res.json();
}

export interface PitchContourData {
  frame_duration: number;
  contour: (number | null)[];  // MIDI values, null = unvoiced
}

export async function getPitchContour(jobId: string): Promise<PitchContourData | null> {
  const res = await fetch(`${BASE}/api/pitch-contour/${jobId}`);
  if (!res.ok) return null;
  return res.json();
}

export async function getMelodyData(jobId: string): Promise<MelodyNote[]> {
  const res = await fetch(`${BASE}/api/melody/${jobId}`);
  if (!res.ok) return [];
  return res.json();
}

export interface PitchFrame {
  time: number;
  actual_hz: number | null;
  target_hz: number | null;
  deviation_cents: number | null;
}

export async function getPitchData(jobId: string): Promise<PitchFrame[]> {
  const res = await fetch(`${BASE}/api/pitch-data/${jobId}`);
  if (!res.ok) return [];
  return res.json();
}

// ── Recordings ────────────────────────────────────────────────────────────────

export async function saveRecording(sessionId: string, params: {
  vocal_job_id: string;
  section_start: number | null;
  section_end: number | null;
}): Promise<{ recording_id: string }> {
  const res = await fetch(`${BASE}/api/sessions/${sessionId}/recordings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`Save recording failed: ${res.statusText}`);
  return res.json();
}

export async function getRecordings(sessionId: string): Promise<RecordingInfo[]> {
  const res = await fetch(`${BASE}/api/sessions/${sessionId}/recordings`);
  if (!res.ok) return [];
  return res.json();
}

export async function deleteRecording(sessionId: string, recordingId: string): Promise<void> {
  await fetch(`${BASE}/api/sessions/${sessionId}/recordings/${recordingId}`, {
    method: 'DELETE',
  });
}

export async function downloadRecordingZip(sessionId: string, recordingId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/sessions/${sessionId}/recordings/${recordingId}/download`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`Download failed: ${res.statusText}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `harmoneez_${recordingId}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
