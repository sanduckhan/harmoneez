import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import type { KeyDetectionResult, PipelineResult } from '../types';
import type { PitchFrame } from '../api';
import { uploadFile, detectKey, startProcessing, audioUrl, getPitchData } from '../api';
import { useJobProgress } from '../hooks/useJobProgress';
import { UploadZone } from '../components/UploadZone';
import { WaveformPlayer } from '../components/WaveformPlayer';
import { SettingsPanel } from '../components/SettingsPanel';
import { ProgressPanel } from '../components/ProgressPanel';
import { ResultsGrid } from '../components/ResultsGrid';

export function UploadPage() {
  const navigate = useNavigate();
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

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
      {!jobId && !uploading && <UploadZone onUpload={handleUpload} />}

      {uploading && (
        <div className="flex items-center justify-center gap-3 py-16">
          <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
            className="w-5 h-5 border-2 border-[var(--amber)] border-t-transparent rounded-full" />
          <span className="text-sm font-mono text-[var(--text-secondary)]">Analyzing track...</span>
        </div>
      )}

      {jobId && !uploading && (
        <>
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-[var(--bg-panel)] border border-[var(--border)]">
            <div className="w-2 h-2 rounded-full bg-[var(--teal)] shadow-[0_0_4px_var(--teal)]" />
            <span className="text-xs font-mono text-[var(--text-secondary)] truncate flex-1">{filename}</span>
            {keyInfo && <span className="text-xs font-mono text-[var(--amber)]">{keyInfo.key}</span>}
            <button onClick={() => setJobId(null)} className="text-[10px] font-mono text-[var(--text-muted)] hover:text-[var(--text-secondary)]">Change</button>
          </div>

          <WaveformPlayer audioUrl={audioUrl(jobId)} onRegionChange={handleRegionChange} pitchData={pitchData} />

          <SettingsPanel
            keyInfo={keyInfo} selectedKey={selectedKey} onKeyChange={setSelectedKey}
            pitchCorrect={pitchCorrect} onPitchCorrectChange={setPitchCorrect}
            harmonyVolume={harmonyVolume} onVolumeChange={setHarmonyVolume}
            regionStart={regionStart} regionEnd={regionEnd}
          />

          <button onClick={handleGenerate} disabled={processing}
            className={`w-full py-3.5 rounded-lg text-sm font-mono uppercase tracking-widest transition-all duration-300 ${
              processing ? 'bg-[var(--bg-surface)] text-[var(--text-muted)] border border-[var(--border)] cursor-not-allowed'
                : 'bg-[var(--amber)] text-[var(--bg-deep)] font-bold hover:shadow-[0_0_30px_var(--amber-glow)] hover:brightness-110'
            }`}>
            {processing ? 'Processing...' : 'Generate Harmonies'}
          </button>

          {processing && <ProgressPanel progress={progress} />}
          {result && <ResultsGrid jobId={jobId} result={result} />}
        </>
      )}

      <button onClick={() => navigate('/')}
        className="text-[10px] font-mono text-[var(--text-muted)] hover:text-[var(--amber)] transition-colors uppercase tracking-wider">
        Back to home
      </button>
    </motion.div>
  );
}
