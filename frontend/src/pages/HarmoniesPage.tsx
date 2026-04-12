import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { resumeSession, getRecordings, deleteRecording, downloadRecordingZip } from '../api';
import type { RecordingInfo } from '../types';
import { StemMixer } from '../components/StemMixer';
import { formatTime } from '../utils';

export function HarmoniesPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [session, setSession] = useState<{
    filename: string; key: string; duration: number;
  } | null>(null);
  const [recordings, setRecordings] = useState<RecordingInfo[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!id) { navigate('/', { replace: true }); return; }
    Promise.all([
      resumeSession(id).then(res => setSession({ filename: res.filename, key: res.key, duration: res.duration })),
      getRecordings(id).then(setRecordings),
    ]).catch(() => {
      navigate('/', { replace: true });
    });
  }, [id, navigate]);

  const handleDelete = useCallback(async (recordingId: string) => {
    if (!id) return;
    await deleteRecording(id, recordingId);
    setRecordings(prev => prev.filter(r => r.id !== recordingId));
    if (expandedId === recordingId) setExpandedId(null);
  }, [id, expandedId]);

  const toggleExpand = useCallback((recordingId: string) => {
    setExpandedId(prev => prev === recordingId ? null : recordingId);
  }, []);

  if (!session) {
    return (
      <div className="flex items-center justify-center gap-3 py-16">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
          className="w-5 h-5 border-2 border-[var(--amber)] border-t-transparent rounded-full"
        />
        <span className="text-sm font-mono text-[var(--text-secondary)]">Loading...</span>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-6"
    >
      {/* Song header */}
      {session && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-[var(--amber)] shadow-[0_0_6px_var(--amber-glow)]" />
            <div>
              <h2 className="text-lg text-[var(--text-primary)]" style={{ fontFamily: "'Instrument Serif', serif" }}>
                {session.filename.replace(/\.[^.]+$/, '')}
              </h2>
              <p className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                {session.key} · {formatTime(session.duration)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(`/song/${id}/practice`)}
              className="px-4 py-1.5 rounded-lg bg-[var(--amber)] text-[var(--bg-deep)] font-mono uppercase tracking-wider text-[11px] font-bold hover:shadow-[0_0_20px_var(--amber-glow)] transition-all"
            >
              New Recording
            </button>
            <button
              onClick={() => navigate(`/song/${id}`)}
              className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--amber)] transition-colors"
            >
              Back to song
            </button>
          </div>
        </div>
      )}

      <div className="h-px bg-gradient-to-r from-transparent via-[var(--border-highlight)] to-transparent" />

      {/* Recordings list */}
      {recordings.length === 0 ? (
        <div className="text-center py-16 space-y-4">
          <p className="text-sm font-mono text-[var(--text-muted)]">No recordings yet</p>
          <button
            onClick={() => navigate(`/song/${id}/practice`)}
            className="px-6 py-2 rounded-lg border border-[var(--border-highlight)] text-sm font-mono text-[var(--text-secondary)] hover:border-[var(--amber)]/50 hover:text-[var(--amber)] transition-all"
          >
            Record your first take
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
            {recordings.length} recording{recordings.length !== 1 ? 's' : ''}
          </p>

          {[...recordings].reverse().map((rec, i) => (
            <RecordingPanel
              key={rec.id}
              sessionId={id!}
              recording={rec}
              index={recordings.length - i}
              isExpanded={expandedId === rec.id}
              onToggle={() => toggleExpand(rec.id)}
              onDelete={() => handleDelete(rec.id)}
            />
          ))}
        </div>
      )}
    </motion.div>
  );
}


interface RecordingPanelProps {
  sessionId: string;
  recording: RecordingInfo;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
}

function RecordingPanel({ sessionId, recording, index, isExpanded, onToggle, onDelete }: RecordingPanelProps) {
  const [downloading, setDownloading] = useState(false);
  const date = new Date(recording.created_at * 1000);
  const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  const sectionLabel = recording.section_start != null && recording.section_end != null
    ? `${formatTime(recording.section_start)}–${formatTime(recording.section_end)}`
    : 'Full song';

  const stems = useMemo(() => {
    const result = [];
    if (recording.corrected_url) {
      result.push({ id: 'vocal', label: 'Your Vocal', url: recording.corrected_url });
    } else if (recording.vocal_url) {
      result.push({ id: 'vocal', label: 'Your Vocal', url: recording.vocal_url });
    }
    for (const h of recording.harmonies) {
      result.push({ id: h.interval, label: h.interval, url: h.harmony_url });
    }
    return result;
  }, [recording]);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] overflow-hidden">
      {/* Header — always visible */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--bg-surface)] transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className={`w-1.5 h-1.5 rounded-full ${isExpanded ? 'bg-[var(--amber)]' : 'bg-[var(--text-muted)]'}`} />
          <span className="text-sm font-mono text-[var(--text-primary)]">
            Take #{index}
          </span>
          <span className="text-[10px] font-mono text-[var(--text-muted)]">
            {sectionLabel}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-[10px] font-mono text-[var(--text-muted)]">
            {dateStr} {timeStr}
          </span>
          <span className="text-[10px] font-mono text-[var(--text-muted)]">
            {formatTime(recording.duration)}
          </span>
          <svg
            width="12" height="12" viewBox="0 0 12 12"
            className={`text-[var(--text-muted)] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          >
            <path d="M2 4L6 8L10 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      </button>

      {/* Expanded content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4">
              <div className="h-px bg-[var(--border)]" />

              {stems.length > 0 ? (
                <StemMixer stems={stems} />
              ) : (
                <p className="text-xs font-mono text-[var(--text-muted)] py-4">No harmony files found</p>
              )}

              <div className="flex items-center justify-between">
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    setDownloading(true);
                    try { await downloadRecordingZip(sessionId, recording.id); }
                    finally { setDownloading(false); }
                  }}
                  disabled={downloading}
                  className="px-4 py-1.5 rounded text-xs font-mono uppercase tracking-wider bg-[var(--amber)] text-[var(--bg-deep)] font-semibold hover:shadow-[0_0_12px_var(--amber-glow)] transition-all disabled:opacity-50"
                >
                  {downloading ? 'Exporting...' : 'Export ZIP'}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--red)] transition-colors"
                >
                  Delete recording
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
