'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/**
 * 'danger' is for anything that went wrong — a failed request, or a form that
 * refused to submit because a required answer is missing.
 *
 * 'alert' is for something arriving that nobody asked for: a delivery moved on
 * somebody else's phone and now needs attention. It is navy rather than teal
 * because teal means "the thing you just did worked", and a new alert is not an
 * outcome of anything the reader did — navy is the colour the portal already uses
 * for money and for the next action.
 *
 * Everything else (saved, sent, copied) uses the default teal.
 */
export type ToastVariant = 'default' | 'alert' | 'danger';

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
    // longest. An alert is a sentence too, and it arrived unprompted — it needs
    // long enough to be read by somebody who was looking elsewhere. A two-word
    // confirmation of something you just pressed needs neither.
    timer.current = setTimeout(
      () => setVisible(false),
      nextVariant === 'danger' ? 4000 : nextVariant === 'alert' ? 3400 : 2400
    );
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
      {/* An alert shares the polite region with a confirmation rather than taking
          the assertive one: it is news, not a failure, and interrupting whatever a
          screen reader is mid-sentence on for "a rider declined" is not warranted.
          Only the colour differs. */}
      <div
        className={`somo-toast${variant === 'alert' ? ' alert' : ''}${visible && !danger ? ' show' : ''}`}
        role="status"
        aria-live="polite"
      >
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
