'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

type ToastFn = (message: string) => void;

const ToastContext = createContext<ToastFn>(() => {});

/** Same single bottom-centre toast the original portal used. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState('');
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback<ToastFn>((next) => {
    setMessage(next);
    setVisible(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), 2400);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className={`somo-toast${visible ? ' show' : ''}`} role="status" aria-live="polite">
        {message}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastFn {
  return useContext(ToastContext);
}
