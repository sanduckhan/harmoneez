import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { KeyDetectionResult, PipelineResult } from './types';
import { uploadFile, detectKey, startProcessing, audioUrl, getPitchData } from './api';
import type { PitchFrame } from './api';
import { useJobProgress } from './hooks/useJobProgress';
import { UploadZone } from './components/UploadZone';
import { WaveformPlayer } from './components/WaveformPlayer';
import { SettingsPanel } from './components/SettingsPanel';
import { ProgressPanel } from './components/ProgressPanel';
import { ResultsGrid } from './components/ResultsGrid';
import { RecordingOverlay } from './components/RecordingOverlay';

function App() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [keyInfo, setKeyInfo] = useState<KeyDetectionResult | null>(null);
  const [selectedKey, setSelectedKey] = useState('C major');

  const [regionStart, setRegionStart] = useState<number | null>(null);
  const [regionEnd, setRegionEnd] = useState<number | null>(null);

  const [pitchCorrect, setPitchCorrect] = useState(true);
  const [harmonyVolume, setHarmonyVolume] = useState(0.7);

  const [processing, setProcessing] = useState(false);
  const progress = useJobProgress(jobId, processing);

  const [result, setResult] = useState<PipelineResult | null>(null);
  const [pitchData, setPitchData] = useState<PitchFrame[]>([]);
  const [recordingMode, setRecordingMode] = useState(false);

  const handleUpload = useCallback(async (file: File) => {
    setUploading(true);
    setResult(null);
    setProcessing(false);
    try {
      const res = await uploadFile(file);
      setJobId(res.job_id);
      setFilename(res.filename);
      const keyRes = await detectKey(res.job_id);
      setKeyInfo(keyRes);
      setSelectedKey(keyRes.key);
    } catch (e) {
      alert(`Upload failed: ${e}`);
    } finally {
      setUploading(false);
    }
  }, []);

  const handleRegionChange = useCallback((start: number | null, end: number | null) => {
    setRegionStart(start);
    setRegionEnd(end);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!jobId) return;
    setProcessing(true);
    setResult(null);
    try {
      await startProcessing(jobId, {
        key: selectedKey,
        start: regionStart ?? undefined,
        end: regionEnd ?? undefined,
        pitch_correct: pitchCorrect,
        harmony_volume: harmonyVolume,
      });
    } catch (e) {
      alert(`Processing failed: ${e}`);
      setProcessing(false);
    }
  }, [jobId, selectedKey, regionStart, regionEnd, pitchCorrect, harmonyVolume]);

  useEffect(() => {
    if (progress?.status === 'completed' && progress.result && !result) {
      setResult(progress.result);
      setProcessing(false);
      // Fetch pitch data
      if (jobId) {
        getPitchData(jobId).then(setPitchData);
      }
    }
    if (progress?.status === 'failed' && processing) {
      setProcessing(false);
    }
  }, [progress]);

  const handleRecordingComplete = useCallback(async (blob: Blob) => {
    setRecordingMode(false);
    setUploading(true);
    setResult(null);
    setPitchData([]);
    try {
      const file = new File([blob], 'recording.webm', { type: 'audio/webm' });
      const res = await uploadFile(file);
      setJobId(res.job_id);
      setFilename('Recording');
      const keyRes = await detectKey(res.job_id);
      setKeyInfo(keyRes);
      setSelectedKey(keyRes.key);
    } catch (e) {
      alert(`Upload failed: ${e}`);
    } finally {
      setUploading(false);
    }
  }, []);

  const resetAll = () => {
    setJobId(null);
    setFilename(null);
    setKeyInfo(null);
    setResult(null);
    setProcessing(false);
    setRegionStart(null);
    setRegionEnd(null);
    setPitchData([]);
    setRecordingMode(false);
  };

  return (
    <div className="min-h-screen bg-[var(--bg-deep)]">
      {/* Subtle top glow */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[200px] bg-[var(--amber)] opacity-[0.02] blur-[100px] pointer-events-none" />

      <div className="relative max-w-4xl mx-auto px-4 py-10 space-y-6">
        {/* Header */}
        <motion.header
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-end justify-between mb-4"
        >
          <div>
            <h1 className="text-3xl tracking-tight" style={{ fontFamily: "'Instrument Serif', serif" }}>
              <span className="text-[var(--text-primary)]">Harmon</span>
              <span className="text-[var(--amber)]">eez</span>
            </h1>
            <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-[var(--text-muted)] mt-1">
              Vocal Harmony Generator
            </p>
          </div>
          {jobId && (
            <button
              onClick={resetAll}
              className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--amber)] transition-colors pb-1"
            >
              New Session
            </button>
          )}
        </motion.header>

        {/* Divider */}
        <div className="h-px bg-gradient-to-r from-transparent via-[var(--border-highlight)] to-transparent" />

        <AnimatePresence mode="wait">
          {/* Upload state */}
          {!jobId && !uploading && (
            <UploadZone key="upload" onUpload={handleUpload} />
          )}

          {/* Loading state */}
          {uploading && (
            <motion.div
              key="uploading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center justify-center gap-3 py-16"
            >
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
                className="w-5 h-5 border-2 border-[var(--amber)] border-t-transparent rounded-full"
              />
              <span className="text-sm font-mono text-[var(--text-secondary)]">
                Analyzing track...
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Work area */}
        {jobId && !uploading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-4"
          >
            {/* File info bar */}
            <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-[var(--bg-panel)] border border-[var(--border)]">
              <div className="w-2 h-2 rounded-full bg-[var(--teal)] shadow-[0_0_4px_var(--teal)]" />
              <span className="text-xs font-mono text-[var(--text-secondary)] truncate flex-1">{filename}</span>
              {keyInfo && (
                <span className="text-xs font-mono text-[var(--amber)]">
                  {keyInfo.key}
                </span>
              )}
              {!recordingMode && !processing && !result && (
                <button
                  onClick={() => setRecordingMode(true)}
                  className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--red)] transition-colors"
                >
                  Record Over This
                </button>
              )}
            </div>

            {/* Recording overlay */}
            <AnimatePresence>
              {recordingMode && (
                <RecordingOverlay
                  referenceAudioUrl={audioUrl(jobId)}
                  onRecordingComplete={handleRecordingComplete}
                  onCancel={() => setRecordingMode(false)}
                />
              )}
            </AnimatePresence>

            {!recordingMode && (
              <>
            <WaveformPlayer
              audioUrl={audioUrl(jobId)}
              onRegionChange={handleRegionChange}
              pitchData={pitchData}
            />

            <SettingsPanel
              keyInfo={keyInfo}
              selectedKey={selectedKey}
              onKeyChange={setSelectedKey}
              pitchCorrect={pitchCorrect}
              onPitchCorrectChange={setPitchCorrect}
              harmonyVolume={harmonyVolume}
              onVolumeChange={setHarmonyVolume}
              regionStart={regionStart}
              regionEnd={regionEnd}
            />

            {/* Generate button */}
            <button
              onClick={handleGenerate}
              disabled={processing}
              className={`
                w-full py-3.5 rounded-lg text-sm font-mono uppercase tracking-widest
                transition-all duration-300
                ${processing
                  ? 'bg-[var(--bg-surface)] text-[var(--text-muted)] border border-[var(--border)] cursor-not-allowed'
                  : 'bg-[var(--amber)] text-[var(--bg-deep)] font-bold hover:shadow-[0_0_30px_var(--amber-glow)] hover:brightness-110'}
              `}
            >
              {processing ? 'Processing...' : 'Generate Harmonies'}
            </button>

            {processing && <ProgressPanel progress={progress} />}

            {result && <ResultsGrid jobId={jobId} result={result} />}
              </>
            )}
          </motion.div>
        )}

        {/* Footer */}
        <div className="h-px bg-gradient-to-r from-transparent via-[var(--border)] to-transparent mt-8" />
        <p className="text-center text-[10px] font-mono text-[var(--text-muted)] tracking-wider pb-4">
          HARMONEEZ v0.3
        </p>
      </div>
    </div>
  );
}

export default App;
