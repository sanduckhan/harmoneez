export function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// Note name to pitch class (0-11)
const NOTE_TO_PC: Record<string, number> = {
  'C': 0, 'C#': 1, 'Db': 1,
  'D': 2, 'D#': 3, 'Eb': 3,
  'E': 4, 'Fb': 4,
  'F': 5, 'F#': 6, 'Gb': 6,
  'G': 7, 'G#': 8, 'Ab': 8,
  'A': 9, 'A#': 10, 'Bb': 10,
  'B': 11, 'Cb': 11,
};

// Major and natural minor scale intervals in semitones from root
const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10];

/**
 * Get the pitch classes (0-11) for a given key name like "Eb minor" or "G major".
 */
export function getScalePitchClasses(keyName: string): number[] {
  const parts = keyName.split(' ');
  const root = parts[0];
  const mode = parts[1]?.toLowerCase() ?? 'major';

  const rootPc = NOTE_TO_PC[root];
  if (rootPc === undefined) return [];

  const intervals = mode === 'minor' ? MINOR_INTERVALS : MAJOR_INTERVALS;
  return intervals.map(i => (rootPc + i) % 12);
}

// Pitch class to preferred note name (for display)
const PC_TO_NOTE = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/**
 * Transpose a key name by N semitones. e.g. transposeKey("Eb minor", -2) → "Db minor"
 */
export function transposeKey(keyName: string, semitones: number): string {
  if (semitones === 0) return keyName;
  const parts = keyName.split(' ');
  const root = parts[0];
  const mode = parts[1] ?? 'major';

  const rootPc = NOTE_TO_PC[root];
  if (rootPc === undefined) return keyName;

  const newPc = ((rootPc + semitones) % 12 + 12) % 12;
  return `${PC_TO_NOTE[newPc]} ${mode}`;
}
