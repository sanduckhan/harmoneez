import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { resumeSession } from '../api';
import { SessionsList } from '../components/SessionsList';

export function LandingPage() {
  const navigate = useNavigate();

  const handleResumeSession = useCallback(async (sessionId: string) => {
    try {
      const res = await resumeSession(sessionId);
      navigate(`/practice/${res.job_id}`);
    } catch (e) {
      alert(`Failed to resume session: ${e}`);
    }
  }, [navigate]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 py-8"
    >
      <button onClick={() => navigate('/practice')} className="w-full group">
        <div className="border border-[var(--border)] rounded-xl p-10 text-center bg-[var(--bg-panel)] hover:border-[var(--amber)]/50 hover:shadow-[0_0_40px_var(--amber-glow)] transition-all duration-300">
          <div className="text-4xl mb-4">🎙</div>
          <p className="text-xl text-[var(--text-primary)] font-medium">Record Over a Track</p>
          <p className="text-sm text-[var(--text-muted)] mt-2 max-w-md mx-auto">
            Upload a reference song, see the melody guide, sing along with real-time pitch feedback, then generate harmonies
          </p>
        </div>
      </button>

      <div className="text-center">
        <button
          onClick={() => navigate('/upload')}
          className="text-sm font-mono text-[var(--text-muted)] hover:text-[var(--amber)] transition-colors"
        >
          or upload a vocal file directly →
        </button>
      </div>

      <SessionsList onResume={handleResumeSession} />
    </motion.div>
  );
}
