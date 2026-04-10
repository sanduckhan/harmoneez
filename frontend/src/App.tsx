import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { KeyDetectionResult, PipelineResult } from './types';
import type { PitchFrame } from './api';
import { uploadFile, detectKey, startProcessing, audioUrl, getPitchData } from './api';
import { useJobProgress } from './hooks/useJobProgress';
import { UploadZone } from './components/UploadZone';
import { WaveformPlayer } from './components/WaveformPlayer';
import { SettingsPanel } from './components/SettingsPanel';
import { ProgressPanel } from './components/ProgressPanel';
import { ResultsGrid } from './components/ResultsGrid';
import { PracticeView } from './components/PracticeView';

type AppMode = 'landing' | 'practice' | 'upload';

function App() {
  const [mode, setMode] = useState<AppMode>('landing');

  // --- Upload flow state (existing) ---
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

  const handleUpload = useCallback(async (file: File) => {
    setUploading(true);
    setResult(null);
    setProcessing(false);
    setPitchData([]);
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
      if (jobId) getPitchData(jobId).then(setPitchData);
    }
    if (progress?.status === 'failed' && processing) {
      setProcessing(false);
    }
  }, [progress]);

  const resetUploadFlow = () => {
    setJobId(null); setFilename(null); setKeyInfo(null);
    setResult(null); setProcessing(false);
    setRegionStart(null); setRegionEnd(null); setPitchData([]);
  };

  return (
    <div className="min-h-screen bg-[var(--bg-deep)]">
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[200px] bg-[var(--amber)] opacity-[0.02] blur-[100px] pointer-events-none" />

      <div className="relative max-w-4xl mx-auto px-4 py-10 space-y-6">
        {/* Header */}
        <motion.header
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-end justify-between mb-4"
        >
          <div
            className="cursor-pointer"
            onClick={() => { setMode('landing'); resetUploadFlow(); }}
          >
            <h1 className="text-3xl tracking-tight" style={{ fontFamily: "'Instrument Serif', serif" }}>
              <span className="text-[var(--text-primary)]">Harmon</span>
              <span className="text-[var(--amber)]">eez</span>
            </h1>
            <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-[var(--text-muted)] mt-1">
              Vocal Harmony Generator
            </p>
          </div>
        </motion.header>

        <div className="h-px bg-gradient-to-r from-transparent via-[var(--border-highlight)] to-transparent" />

        <AnimatePresence mode="wait">
          {/* ═══ Landing Page ═══ */}
          {mode === 'landing' && (
            <motion.div
              key="landing"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6 py-8"
            >
              {/* Primary: Record over a track */}
              <button
                onClick={() => setMode('practice')}
                className="w-full group"
              >
                <div className="border border-[var(--border)] rounded-xl p-10 text-center bg-[var(--bg-panel)] hover:border-[var(--amber)]/50 hover:shadow-[0_0_40px_var(--amber-glow)] transition-all duration-300">
                  <div className="text-4xl mb-4">🎙</div>
                  <p className="text-xl text-[var(--text-primary)] font-medium">
                    Record Over a Track
                  </p>
                  <p className="text-sm text-[var(--text-muted)] mt-2 max-w-md mx-auto">
                    Upload a reference song, see the melody guide, sing along with real-time pitch feedback, then generate harmonies
                  </p>
                </div>
              </button>

              {/* Secondary: Upload a vocal file */}
              <div className="text-center">
                <button
                  onClick={() => setMode('upload')}
                  className="text-sm font-mono text-[var(--text-muted)] hover:text-[var(--amber)] transition-colors"
                >
                  or upload a vocal file directly →
                </button>
              </div>
            </motion.div>
          )}

          {/* ═══ Practice Flow ═══ */}
          {mode === 'practice' && (
            <motion.div
              key="practice"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <PracticeView onBack={() => setMode('landing')} />
            </motion.div>
          )}

          {/* ═══ Upload Flow (existing) ═══ */}
          {mode === 'upload' && (
            <motion.div
              key="upload"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              {!jobId && !uploading && (
                <UploadZone onUpload={handleUpload} />
              )}

              {uploading && (
                <div className="flex items-center justify-center gap-3 py-16">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
                    className="w-5 h-5 border-2 border-[var(--amber)] border-t-transparent rounded-full"
                  />
                  <span className="text-sm font-mono text-[var(--text-secondary)]">Analyzing track...</span>
                </div>
              )}

              {jobId && !uploading && (
                <>
                  <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-[var(--bg-panel)] border border-[var(--border)]">
                    <div className="w-2 h-2 rounded-full bg-[var(--teal)] shadow-[0_0_4px_var(--teal)]" />
                    <span className="text-xs font-mono text-[var(--text-secondary)] truncate flex-1">{filename}</span>
                    {keyInfo && <span className="text-xs font-mono text-[var(--amber)]">{keyInfo.key}</span>}
                    <button onClick={() => { resetUploadFlow(); }} className="text-[10px] font-mono text-[var(--text-muted)] hover:text-[var(--text-secondary)]">Change</button>
                  </div>

                  <WaveformPlayer audioUrl={audioUrl(jobId)} onRegionChange={handleRegionChange} pitchData={pitchData} />

                  <SettingsPanel
                    keyInfo={keyInfo} selectedKey={selectedKey} onKeyChange={setSelectedKey}
                    pitchCorrect={pitchCorrect} onPitchCorrectChange={setPitchCorrect}
                    harmonyVolume={harmonyVolume} onVolumeChange={setHarmonyVolume}
                    regionStart={regionStart} regionEnd={regionEnd}
                  />

                  <button
                    onClick={handleGenerate}
                    disabled={processing}
                    className={`w-full py-3.5 rounded-lg text-sm font-mono uppercase tracking-widest transition-all duration-300 ${
                      processing
                        ? 'bg-[var(--bg-surface)] text-[var(--text-muted)] border border-[var(--border)] cursor-not-allowed'
                        : 'bg-[var(--amber)] text-[var(--bg-deep)] font-bold hover:shadow-[0_0_30px_var(--amber-glow)] hover:brightness-110'
                    }`}
                  >
                    {processing ? 'Processing...' : 'Generate Harmonies'}
                  </button>

                  {processing && <ProgressPanel progress={progress} />}
                  {result && <ResultsGrid jobId={jobId} result={result} />}
                </>
              )}

              <button onClick={() => { setMode('landing'); resetUploadFlow(); }}
                className="text-[10px] font-mono text-[var(--text-muted)] hover:text-[var(--amber)] transition-colors uppercase tracking-wider">
                Back to home
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="h-px bg-gradient-to-r from-transparent via-[var(--border)] to-transparent mt-8" />
        <p className="text-center text-[10px] font-mono text-[var(--text-muted)] tracking-wider pb-4">HARMONEEZ v0.4</p>
      </div>
    </div>
  );
}

export default App;
