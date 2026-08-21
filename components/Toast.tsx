'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/**
 * 'danger' is for anything that went wrong — a failed request, or a form that
 * refused to submit because a required answer is missing. Everything else
 * (saved, sent, copied) uses the default teal.
 */
export type ToastVariant = 'default' | 'danger';

type ToastFn = (message: string, variant?: ToastVariant) => void;

const ToastContext = createContext<ToastFn>(() => {});

/** Same single bottom-centre toast the original portal used. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState('');
  const [variant, setVariant] = useState<ToastVariant>('default');
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback<ToastFn>((next, nextVariant = 'default') => {
    setMessage(next);
    setVariant(nextVariant);
    setVisible(true);
    if (timer.current) clearTimeout(timer.current);
    // An error is usually a sentence telling you what to fix, so it stays up
    // longer than a two-word confirmation.
    timer.current = setTimeout(() => setVisible(false), nextVariant === 'danger' ? 4000 : 2400);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const danger = variant === 'danger';

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {/* Two live regions rather than one with a swapped role: assistive tech is
          not reliably told about a role/aria-live change on a node it is already
          watching, so each politeness level gets its own permanent region and
          only the matching one is ever filled. Whichever is empty is invisible. */}
      <div className={`somo-toast${visible && !danger ? ' show' : ''}`} role="status" aria-live="polite">
        {danger ? '' : message}
      </div>
      <div
        className={`somo-toast danger${visible && danger ? ' show' : ''}`}
        role="alert"
        aria-live="assertive"
      >
        {danger ? message : ''}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastFn {
  return useContext(ToastContext);
}
