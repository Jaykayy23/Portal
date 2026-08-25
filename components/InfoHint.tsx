'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { CircleQuestionMark } from 'lucide-react';

/** Breathing room kept between the bubble and the viewport edge. */
const EDGE_MARGIN = 12;

/**
 * The "?" beside a heading or a field label.
 *
 * Every card in the portal used to open with a paragraph of grey prose
 * explaining itself. That is right once and wrong every day after: an operator
 * who files twenty deliveries a week reads it on day one and scrolls past it
 * for the next two years. The words are unchanged — they moved behind this
 * trigger, so the explanation costs nothing until somebody wants it.
 *
 * Three ways in, because the portal is used at a desk and on a phone:
 * hovering the "?" with a mouse, focusing it with the keyboard, or tapping it.
 * Tap pins the bubble open — `pointerenter` fires on touch too, so mouse
 * handlers check `pointerType` and leave touch to the click handler, which
 * would otherwise open and immediately close on one tap.
 *
 * It is a disclosure, not a `role="tooltip"`: some of these hints contain a
 * link, and a tooltip is not somewhere you can travel to.
 */
export function InfoHint({
  label,
  children,
}: {
  /** Names what is being explained; becomes the button's accessible name. */
  label: string;
  children: React.ReactNode;
}) {
  const bubbleId = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<number | null>(null);

  const [hovering, setHovering] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [focused, setFocused] = useState(false);
  const open = hovering || pinned || focused;

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  useEffect(() => cancelClose, [cancelClose]);

  /**
   * Keep the bubble on screen.
   *
   * It is anchored to the "?", and the "?" sits wherever its heading text ends —
   * so on a phone a long heading pushes a 292px bubble clean off the right edge.
   * This measures once per open and slides it back, moving the notch the other
   * way by the same amount so it still points at the mark it belongs to.
   */
  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    if (!open || !bubble) return;

    const place = () => {
      bubble.style.setProperty('--hint-dx', '0px');
      const box = bubble.getBoundingClientRect();

      let dx = 0;
      if (box.right > window.innerWidth - EDGE_MARGIN) {
        dx = window.innerWidth - EDGE_MARGIN - box.right;
      }
      if (box.left + dx < EDGE_MARGIN) dx = EDGE_MARGIN - box.left;
      dx = Math.round(dx);

      bubble.style.setProperty('--hint-dx', `${dx}px`);
      // The notch travels back with the bubble, clamped so it cannot slide off
      // the bubble's own rounded corners.
      const notch = Math.min(Math.max(13 - dx, 10), Math.max(box.width - 18, 10));
      bubble.style.setProperty('--hint-notch', `${Math.round(notch)}px`);
    };

    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  // Escape closes whichever way it was opened and puts focus back on the "?",
  // so a keyboard reader is never stranded inside a bubble they dismissed.
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      cancelClose();
      setPinned(false);
      setHovering(false);
      // `focused` goes too, or a bubble opened by tabbing to the "?" would still
      // be open after Escape: focus has not moved, so nothing else would clear
      // it. Focus stays put and no fresh focus event fires, so it stays shut
      // until the trigger is pressed or tabbed away from and back to.
      setFocused(false);
      if (wrapRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
    };
    // Pointer down rather than click: a pinned bubble should close the moment
    // the next tap lands, not after whatever it landed on has finished.
    const onPointerDown = (e: PointerEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setPinned(false);
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, cancelClose]);

  return (
    <span
      ref={wrapRef}
      className="somo-hint"
      onPointerEnter={(e) => {
        if (e.pointerType !== 'mouse') return;
        cancelClose();
        setHovering(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== 'mouse') return;
        cancelClose();
        // A grace period, so the pointer can travel from the "?" into the
        // bubble to reach a link inside it without it vanishing en route.
        closeTimer.current = window.setTimeout(() => setHovering(false), 160);
      }}
      onFocus={() => {
        cancelClose();
        setFocused(true);
      }}
      onBlur={(e) => {
        if (wrapRef.current?.contains(e.relatedTarget as Node | null)) return;
        setFocused(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`somo-hint-trigger${open ? ' open' : ''}`}
        aria-label={`More about ${label}`}
        aria-expanded={open}
        aria-controls={bubbleId}
        onClick={(e) => {
          // These triggers sit inside <label> elements. A label forwards a
          // click to its control unless the target is interactive content —
          // a button is, but stopping here makes that independent of how
          // faithfully the browser implements it.
          e.preventDefault();
          e.stopPropagation();
          setPinned((current) => !current);
        }}
      >
        <CircleQuestionMark size={15} strokeWidth={2} aria-hidden="true" />
      </button>
      <span
        ref={bubbleRef}
        id={bubbleId}
        role="note"
        className="somo-hint-bubble"
        hidden={!open}
      >
        {children}
      </span>
    </span>
  );
}
