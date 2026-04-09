import { useCallback, useState } from 'react';
import { motion } from 'motion/react';

interface Props {
  onUpload: (file: File) => void;
  disabled?: boolean;
}

export function UploadZone({ onUpload, disabled }: Props) {
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onUpload(file);
  }, [onUpload]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onUpload(file);
  }, [onUpload]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => !disabled && document.getElementById('file-input')?.click()}
      className={`
        relative cursor-pointer group
        border rounded-xl p-16 text-center
        transition-all duration-300
        ${dragging
          ? 'border-[var(--amber)] bg-[var(--amber-glow)] shadow-[0_0_40px_var(--amber-glow)]'
          : 'border-[var(--border)] hover:border-[var(--border-highlight)] bg-[var(--bg-panel)]'}
        ${disabled ? 'opacity-40 pointer-events-none' : ''}
      `}
    >
      <input
        id="file-input"
        type="file"
        accept=".wav,.mp3"
        onChange={handleChange}
        className="hidden"
      />

      {/* VU meter inspired icon */}
      <div className="relative mx-auto w-20 h-20 mb-6">
        <div className="absolute inset-0 rounded-full border-2 border-[var(--border-highlight)] bg-[var(--bg-surface)]" />
        <div className="absolute inset-[6px] rounded-full border border-[var(--border)]" />
        <motion.div
          animate={dragging ? { rotate: 30 } : { rotate: -30 }}
          transition={{ type: 'spring', stiffness: 200 }}
          className="absolute bottom-[12px] left-1/2 w-[2px] h-[28px] bg-[var(--amber)] origin-bottom rounded-full"
          style={{ transformOrigin: 'bottom center', x: '-50%' }}
        />
        <div className="absolute bottom-[10px] left-1/2 w-2 h-2 -translate-x-1/2 rounded-full bg-[var(--amber)] shadow-[0_0_6px_var(--amber)]" />
      </div>

      <p className="text-lg text-[var(--text-primary)] font-medium tracking-wide">
        Drop your track here
      </p>
      <p className="text-sm text-[var(--text-muted)] mt-2 font-mono">
        WAV or MP3
      </p>

      {/* Corner accents */}
      <div className="absolute top-3 left-3 w-4 h-4 border-l border-t border-[var(--border-highlight)] rounded-tl opacity-40" />
      <div className="absolute top-3 right-3 w-4 h-4 border-r border-t border-[var(--border-highlight)] rounded-tr opacity-40" />
      <div className="absolute bottom-3 left-3 w-4 h-4 border-l border-b border-[var(--border-highlight)] rounded-bl opacity-40" />
      <div className="absolute bottom-3 right-3 w-4 h-4 border-r border-b border-[var(--border-highlight)] rounded-br opacity-40" />
    </motion.div>
  );
}
