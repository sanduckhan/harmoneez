import { useEffect, useRef, useState } from 'react';
import type { ProgressMessage } from '../types';

export function useJobProgress(jobId: string | null, processing: boolean) {
  const [progress, setProgress] = useState<ProgressMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!jobId || !processing) return;

    const ws = new WebSocket(`ws://${window.location.host}/ws/${jobId}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const data: ProgressMessage = JSON.parse(event.data);
      setProgress(data);
    };

    ws.onerror = () => {
      setProgress(prev => prev ? { ...prev, status: 'failed', error: 'WebSocket connection lost' } : null);
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [jobId, processing]);

  return progress;
}
