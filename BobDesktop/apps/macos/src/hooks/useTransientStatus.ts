import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * Hook to manage a transient status message (e.g. "Saved!", "Copied!")
 * that clears itself after a specified timeout.
 */
export function useTransientStatus(timeoutMs: number = 3000) {
  const [status, setStatusState] = useState<string>('');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setStatus = useCallback((newStatus: string) => {
    setStatusState(newStatus);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    if (newStatus) {
      timeoutRef.current = setTimeout(() => {
        setStatusState('');
      }, timeoutMs);
    }
  }, [timeoutMs]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return [status, setStatus] as const;
}
