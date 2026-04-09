import { useState, useCallback, useEffect } from 'react';
import type { KeyDetectionResult, PipelineResult } from './types';
import { uploadFile, detectKey, startProcessing, audioUrl } from './api';
import { useJobProgress } from './hooks/useJobProgress';
import { UploadZone } from './components/UploadZone';
import { WaveformPlayer } from './components/WaveformPlayer';
import { SettingsPanel } from './components/SettingsPanel';
import { ProgressPanel } from './components/ProgressPanel';
import { ResultsGrid } from './components/ResultsGrid';

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
    }
    if (progress?.status === 'failed' && processing) {
      setProcessing(false);
    }
  }, [progress]);

  return (
    <div className="min-h-screen bg-gray-900">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white">Harmoneez</h1>
          <p className="text-gray-400 mt-1">Vocal harmony generator for rock bands</p>
        </div>

        {!jobId && (
          <UploadZone onUpload={handleUpload} disabled={uploading} />
        )}

        {uploading && (
          <p className="text-center text-gray-400">Uploading and detecting key...</p>
        )}

        {jobId && !uploading && (
          <>
            <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg">
              <span className="text-sm text-gray-300">{filename}</span>
              <button
                onClick={() => {
                  setJobId(null);
                  setFilename(null);
                  setKeyInfo(null);
                  setResult(null);
                  setProcessing(false);
                  setRegionStart(null);
                  setRegionEnd(null);
                }}
                className="text-xs text-gray-500 hover:text-gray-300"
              >
                Upload different file
              </button>
            </div>

            <WaveformPlayer
              audioUrl={audioUrl(jobId)}
              onRegionChange={handleRegionChange}
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

            <button
              onClick={handleGenerate}
              disabled={processing}
              className={`
                w-full py-3 rounded-lg text-lg font-semibold transition-colors
                ${processing
                  ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                  : 'bg-purple-600 hover:bg-purple-500 text-white'}
              `}
            >
              {processing ? 'Processing...' : 'Generate Harmonies'}
            </button>

            {processing && <ProgressPanel progress={progress} />}

            {result && <ResultsGrid jobId={jobId} result={result} />}
          </>
        )}
      </div>
    </div>
  );
}

export default App;
