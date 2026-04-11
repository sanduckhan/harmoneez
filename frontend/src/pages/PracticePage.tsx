import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { uploadFile, resumeSession } from '../api';
import { UploadZone } from '../components/UploadZone';
import { PracticeView } from '../components/PracticeView';

export function PracticePage() {
  const navigate = useNavigate();
  const { jobId } = useParams();

  // No jobId = upload step
  const handleUpload = useCallback(async (file: File) => {
    try {
      const res = await uploadFile(file);
      navigate(`/practice/${res.job_id}/key`, { replace: true });
    } catch (e) {
      alert(`Upload failed: ${e}`);
    }
  }, [navigate]);

  // Has jobId = load session and show canvas
  const [resumedData, setResumedData] = useState<{
    jobId: string; filename: string; key: string; duration: number;
  } | null>(null);

  useEffect(() => {
    if (jobId && !resumedData) {
      resumeSession(jobId).then(res => {
        setResumedData({ jobId: res.job_id, filename: res.filename, key: res.key, duration: res.duration });
      }).catch(() => {
        navigate('/practice', { replace: true });
      });
    }
  }, [jobId, resumedData, navigate]);

  // No jobId — show upload
  if (!jobId) {
    return (
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
        <UploadZone onUpload={handleUpload} />
        <button onClick={() => navigate('/')}
          className="text-[10px] font-mono text-[var(--text-muted)] hover:text-[var(--amber)] transition-colors uppercase tracking-wider">
          Back to home
        </button>
      </motion.div>
    );
  }

  // Loading session
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

  // Canvas
  return (
    <PracticeView
      onBack={() => navigate('/')}
      resumedSession={resumedData}
    />
  );
}
