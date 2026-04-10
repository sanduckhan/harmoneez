import type { UploadResult, KeyDetectionResult, PipelineResult } from './types';

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

import type { MelodyNote } from './types';

export async function prepareReference(jobId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/prepare/${jobId}`, { method: 'POST' });
  if (!res.ok) throw new Error(`Prepare failed: ${res.statusText}`);
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
