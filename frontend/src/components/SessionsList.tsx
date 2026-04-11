import { useState, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import { getSessions, deleteSession, type SessionInfo } from '../api';
import { formatTime } from '../utils';

interface Props {
  onResume: (session: SessionInfo) => void;
}

export function SessionsList({ onResume }: Props) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSessions().then((s) => {
      setSessions(s);
      setLoading(false);
    });
  }, []);

  const handleDelete = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteSession(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
  }, []);

  if (loading || sessions.length === 0) return null;

  const formatDate = (ts: number) => {
    const d = new Date(ts * 1000);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="space-y-3"
    >
      <h2 className="text-xs font-mono uppercase tracking-widest text-[var(--text-muted)]">
        Recent Sessions
      </h2>
      <div className="space-y-1">
        {sessions.slice(0, 5).map((session) => (
          <div
            key={session.id}
            className="flex items-center gap-3 px-4 py-3 rounded-lg bg-[var(--bg-panel)] border border-[var(--border)] hover:border-[var(--border-highlight)] transition-all group"
          >
            <div className="w-2 h-2 rounded-full bg-[var(--amber)] opacity-50 group-hover:opacity-100 transition-opacity" />
            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onResume(session)}>
              <p className="text-sm text-[var(--text-primary)] truncate font-mono">
                {session.filename}
              </p>
              <p className="text-[10px] text-[var(--text-muted)] font-mono">
                {session.key} · {formatTime(session.duration)} · {session.melody_count} notes · {formatDate(session.created_at)}
              </p>
            </div>
            <button
              onClick={() => onResume(session)}
              className="text-[10px] font-mono text-[var(--text-muted)] group-hover:text-[var(--amber)] transition-colors uppercase tracking-wider"
            >
              Resume
            </button>
            <button
              onClick={(e) => handleDelete(session.id, e)}
              className="text-[10px] font-mono text-[var(--text-muted)] hover:text-[var(--red)] transition-colors uppercase tracking-wider"
            >
              Del
            </button>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
