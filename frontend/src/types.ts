export interface UploadResult {
  job_id: string;
  filename: string;
  duration: number;
  sample_rate: number;
}

export interface KeyCandidate {
  key: string;
  confidence: number;
}

export interface KeyDetectionResult {
  key: string;
  confidence: number;
  candidates: KeyCandidate[];
  has_key_change: boolean;
}

export interface IntervalFile {
  interval: string;
  harmony_path?: string;
  mixed_path?: string;
  harmony_url: string;
  mixed_url: string;
}

export interface PipelineResult {
  key: string;
  confidence: number;
  candidates: [string, number][];
  has_key_change: boolean;
  corrected_path: string | null;
  corrected_url?: string;
  instrumental_path?: string;
  instrumental_url?: string;
  files: IntervalFile[];
}

export interface ProgressMessage {
  step: string;
  message: string;
  step_num: number;
  total_steps: number;
  status: string;
  result?: PipelineResult;
  error?: string;
}

export const ALL_KEYS = [
  'C major', 'C minor', 'C# major', 'C# minor',
  'D major', 'D minor', 'Eb major', 'Eb minor',
  'E major', 'E minor', 'F major', 'F minor',
  'F# major', 'F# minor', 'G major', 'G minor',
  'Ab major', 'Ab minor', 'A major', 'A minor',
  'Bb major', 'Bb minor', 'B major', 'B minor',
];

export type FlowStep = 'loading' | 'guide' | 'recording' | 'review' | 'generating';

export interface MelodyNote {
  start_sec: number;
  end_sec: number;
  midi_pitch: number;
  velocity: number;
}

export interface PitchSample {
  time: number;
  hz: number | null;
  midi: number | null;
  clarity: number;
}

export const INTERVAL_TYPES = [
  '3rd-above', '3rd-below', '5th', '6th', 'octave',
  'unison', 'drone-root', 'drone-5th',
];

export interface RecordingHarmony {
  interval: string;
  harmony_url: string;
  mixed_url: string;
}

export interface RecordingInfo {
  id: string;
  created_at: number;
  duration: number;
  section_start: number | null;
  section_end: number | null;
  vocal_url: string | null;
  corrected_url: string | null;
  harmonies: RecordingHarmony[];
}
