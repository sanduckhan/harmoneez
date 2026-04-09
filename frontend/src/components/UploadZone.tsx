import { useCallback, useState } from 'react';

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
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`
        border-2 border-dashed rounded-xl p-12 text-center cursor-pointer
        transition-colors duration-200
        ${dragging ? 'border-purple-400 bg-purple-400/10' : 'border-gray-600 hover:border-gray-400'}
        ${disabled ? 'opacity-50 pointer-events-none' : ''}
      `}
      onClick={() => !disabled && document.getElementById('file-input')?.click()}
    >
      <input
        id="file-input"
        type="file"
        accept=".wav,.mp3"
        onChange={handleChange}
        className="hidden"
      />
      <div className="text-4xl mb-4">🎤</div>
      <p className="text-lg text-gray-300">Drop a WAV or MP3 file here</p>
      <p className="text-sm text-gray-500 mt-2">or click to browse</p>
    </div>
  );
}
