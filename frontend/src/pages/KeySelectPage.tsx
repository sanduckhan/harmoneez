import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { detectKey, prepareReference, resumeSession, audioUrl } from '../api';
import { useJobProgress } from '../hooks/useJobProgress';
import { useWebAudioPlayer } from '../hooks/useWebAudioPlayer';
import { ProgressPanel } from '../components/ProgressPanel';
import { formatTime, transposeKey } from '../utils';

export function KeySelectPage() {
  const navigate = useNavigate();
  const { jobId } = useParams<{ jobId: string }>();

  const [detectedKey, setDetectedKey] = useState<string | null>(null);
  const [transposeOffset, setTransposeOffset] = useState(0);
  const [detecting, setDetecting] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const progress = useJobProgress(jobId ?? null, processing);

  const webAudio = useWebAudioPlayer({
    url: jobId ? audioUrl(jobId) : null,
    detune: transposeOffset * 100,
    onTimeUpdate: (t) => setCurrentTime(t),
  });

  // Detect key on mount — try resumeSession first (restores from disk), fall back to direct detect
  useEffect(() => {
    if (!jobId) return;
    setDetecting(true);

    // Ensure job is in server memory, then detect key
    const ensureJobAndDetect = async () => {
      // Try to restore from disk (silent fail if it's a fresh upload — job already in memory)
      try { await resumeSession(jobId); } catch {}
      const res = await detectKey(jobId);
      setDetectedKey(res.key);
      setDetecting(false);
    };

    ensureJobAndDetect().catch(() => {
      alert('Key detection failed');
      navigate('/practice');
    });
  }, [jobId, navigate]);

  // Watch processing completion
  useEffect(() => {
    if (progress?.status === 'completed' && processing) {
      setProcessing(false);
      navigate(`/practice/${jobId}`, { replace: true });
    }
    if (progress?.status === 'failed' && processing) {
      setProcessing(false);
      alert('Processing failed: ' + (progress.error || 'Unknown error'));
    }
  }, [progress, processing, jobId, navigate]);

  const handleConfirm = useCallback(async () => {
    if (!jobId) return;
    webAudio.pause();
    setProcessing(true);
    try {
      const transposedKey = detectedKey ? transposeKey(detectedKey, transposeOffset) : '';
      await prepareReference(jobId, transposeOffset, transposedKey);
    } catch (e) {
      alert(`Processing failed: ${e}`);
      setProcessing(false);
    }
  }, [jobId, transposeOffset, detectedKey, webAudio]);

  if (detecting) {
    return (
      <div className="flex items-center justify-center gap-3 py-16">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
          className="w-5 h-5 border-2 border-[var(--amber)] border-t-transparent rounded-full"
        />
        <span className="text-sm font-mono text-[var(--text-secondary)]">Detecting key...</span>
      </div>
    );
  }

  if (processing) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-[var(--bg-panel)] border border-[var(--border)]">
          <div className="w-2 h-2 rounded-full bg-[var(--amber)] shadow-[0_0_4px_var(--amber)]" />
          <span className="text-xs font-mono text-[var(--text-secondary)]">
            {detectedKey && transposeKey(detectedKey, transposeOffset)}
            {transposeOffset !== 0 && ` (${transposeOffset > 0 ? '+' : ''}${transposeOffset})`}
          </span>
        </div>
        <ProgressPanel progress={progress} />
      </div>
    );
  }

  const displayKey = detectedKey ? transposeKey(detectedKey, transposeOffset) : '';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] p-8 text-center space-y-6">
        <div>
          <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-widest">Detected Key</span>
          <p className="text-lg font-mono text-[var(--text-primary)] mt-1">{detectedKey}</p>
        </div>

        <div>
          <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-widest">Transpose</span>
          <div className="flex items-center justify-center gap-2 mt-2">
            <button
              onClick={() => setTransposeOffset(v => Math.max(-6, v - 1))}
              className="w-10 h-10 flex items-center justify-center rounded-lg bg-[var(--bg-surface)] border border-[var(--border-highlight)] text-lg font-bold text-[var(--text-secondary)] hover:text-[var(--amber)] hover:border-[var(--amber)]/50 transition-all"
            >−</button>
            <div className="min-w-[140px] text-center">
              <p className="text-xl font-mono text-[var(--amber)]">{displayKey}</p>
              {transposeOffset !== 0 && (
                <p className="text-[10px] font-mono text-[var(--text-muted)]">
                  {transposeOffset > 0 ? '+' : ''}{transposeOffset} semitone{Math.abs(transposeOffset) !== 1 ? 's' : ''}
                </p>
              )}
            </div>
            <button
              onClick={() => setTransposeOffset(v => Math.min(6, v + 1))}
              className="w-10 h-10 flex items-center justify-center rounded-lg bg-[var(--bg-surface)] border border-[var(--border-highlight)] text-lg font-bold text-[var(--text-secondary)] hover:text-[var(--amber)] hover:border-[var(--amber)]/50 transition-all"
            >+</button>
          </div>
        </div>

        {/* Transport */}
        <div className="space-y-3">
          <div className="flex items-center gap-3 justify-center">
            <button
              onClick={() => webAudio.togglePlay()}
              disabled={webAudio.loading}
              className={`flex items-center gap-2 px-5 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-highlight)] hover:border-[var(--amber)]/50 text-sm font-mono transition-all ${
                webAudio.loading ? 'text-[var(--text-muted)] cursor-wait' : 'text-[var(--text-secondary)]'
              }`}
            >
              {webAudio.loading ? (
                <span>Loading...</span>
              ) : webAudio.playing ? (
                <><span className="w-3 h-3 border-l-2 border-r-2 border-[var(--amber)]" /> PAUSE</>
              ) : (
                <><span className="w-0 h-0 border-l-[8px] border-l-[var(--amber)] border-y-[5px] border-y-transparent" /> PLAY</>
              )}
            </button>
            <span className="font-mono text-sm text-[var(--amber)] tabular-nums">{formatTime(currentTime)}</span>
            <span className="font-mono text-sm text-[var(--text-muted)]">/</span>
            <span className="font-mono text-sm text-[var(--text-secondary)] tabular-nums">{formatTime(webAudio.duration)}</span>
          </div>
          <div
            className="w-full h-2 bg-[var(--bg-surface)] rounded-full cursor-pointer border border-[var(--border)]"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = (e.clientX - rect.left) / rect.width;
              webAudio.seek(pct * webAudio.duration);
            }}
          >
            <div
              className="h-full bg-[var(--amber)] rounded-full"
              style={{ width: `${webAudio.duration > 0 ? Math.min(100, (currentTime / webAudio.duration) * 100) : 0}%` }}
            />
          </div>
          {transposeOffset !== 0 && (
            <p className="text-[10px] font-mono text-[var(--text-muted)] text-center">
              Preview speed may vary slightly due to pitch shift
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <button
          onClick={() => { webAudio.pause(); navigate('/practice'); }}
          className="text-xs font-mono text-[var(--text-muted)] hover:text-[var(--amber)] transition-colors uppercase tracking-wider"
        >
          ← Back
        </button>
        <button
          onClick={handleConfirm}
          className="px-8 py-3 rounded-lg bg-[var(--amber)] text-[var(--bg-deep)] font-mono uppercase tracking-wider text-sm font-bold hover:shadow-[0_0_30px_var(--amber-glow)] transition-all"
        >
          Confirm & Process →
        </button>
      </div>
    </motion.div>
  );
}
