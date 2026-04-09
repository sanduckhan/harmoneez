import { useEffect, useRef, useState } from 'react';
import type { ProgressMessage } from '../types';

export function useJobProgress(jobId: string | null, processing: boolean) {
  const [progress, setProgress] = useState<ProgressMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    setProgress(null);
    if (!jobId || !processing) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/${jobId}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const data: ProgressMessage = JSON.parse(event.data);
      setProgress(data);
    };

    ws.onerror = (e) => {
      console.error('WebSocket error:', e);
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [jobId, processing]);

  return progress;
}
