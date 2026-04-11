import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { uploadFile, resumeSession } from '../api';
import type { SessionInfo } from '../api';
import { UploadZone } from '../components/UploadZone';
import { SessionsList } from '../components/SessionsList';

export function HomePage() {
  const navigate = useNavigate();
  const [uploading, setUploading] = useState(false);

  const handleUpload = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const res = await uploadFile(file);
      navigate(`/song/${res.job_id}`, { state: { filename: res.filename } });
    } catch (e) {
      alert(`Upload failed: ${e}`);
      setUploading(false);
    }
  }, [navigate]);

  const handleResumeSession = useCallback(async (session: SessionInfo) => {
    try {
      const res = await resumeSession(session.id);
      if (session.melody_count > 0) {
        navigate(`/song/${res.job_id}/practice`);
      } else {
        navigate(`/song/${res.job_id}`, { state: { filename: session.filename } });
      }
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
      {uploading ? (
        <div className="flex items-center justify-center gap-3 py-16">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
            className="w-5 h-5 border-2 border-[var(--amber)] border-t-transparent rounded-full"
          />
          <span className="text-sm font-mono text-[var(--text-secondary)]">Uploading...</span>
        </div>
      ) : (
        <UploadZone onUpload={handleUpload} />
      )}

      <SessionsList onResume={handleResumeSession} />
    </motion.div>
  );
}
