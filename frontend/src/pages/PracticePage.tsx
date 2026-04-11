import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { resumeSession } from '../api';
import { PracticeView } from '../components/PracticeView';

export function PracticePage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [resumedData, setResumedData] = useState<{
    jobId: string; filename: string; key: string; duration: number;
  } | null>(null);

  useEffect(() => {
    if (!id) { navigate('/', { replace: true }); return; }
    resumeSession(id).then(res => {
      setResumedData({ jobId: res.job_id, filename: res.filename, key: res.key, duration: res.duration });
    }).catch(() => {
      navigate('/', { replace: true });
    });
  }, [id, navigate]);

  if (!resumedData) {
    return (
      <div className="flex items-center justify-center gap-3 py-16">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
          className="w-5 h-5 border-2 border-[var(--amber)] border-t-transparent rounded-full"
        />
        <span className="text-sm font-mono text-[var(--text-secondary)]">Loading session...</span>
      </div>
    );
  }

  return (
    <PracticeView
      onBack={() => navigate(`/song/${id}`)}
      onChangeKey={() => navigate(`/song/${id}`)}
      resumedSession={resumedData}
    />
  );
}
