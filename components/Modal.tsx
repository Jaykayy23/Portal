'use client';

import { useEffect } from 'react';

interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  wide?: boolean;
  closeLabel?: string;
  onClose: () => void;
  children?: React.ReactNode;
}

export function Modal({
  open,
  title,
  description,
  wide,
  closeLabel = 'Done',
  onClose,
  children,
}: ModalProps) {
  // Escape to dismiss — the original portal was click-only.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="somo-modal-backdrop show"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`somo-modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        {description ? <p>{description}</p> : null}
        {children}
        <button className="somo-btn ghost" style={{ marginTop: 14 }} onClick={onClose}>
          {closeLabel}
        </button>
      </div>
    </div>
  );
}
