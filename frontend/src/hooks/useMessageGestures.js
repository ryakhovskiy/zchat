import { useCallback, useEffect, useRef } from 'react';

const MOVE_TOLERANCE = 10;   // px a finger may drift before a long-press is cancelled
const SWIPE_DISTANCE = 64;   // px to the right that triggers "reply"
const SWIPE_MAX_DRIFT = 36;  // px vertical drift allowed during a swipe

/**
 * Touch gestures for one message: long-press opens the action sheet, swipe right replies.
 * Mouse users get right-click via onContextMenu. Input type is detected from the pointer
 * event / (pointer: coarse), never from the viewport width.
 *
 * Needs `touch-action: pan-y` on the element so horizontal moves are delivered, not scrolled.
 */
export const useMessageGestures = ({ onOpenActions, onSwipeReply, coarse, longPressMs = 450 }) => {
  const elementRef = useRef(null);
  const gesture = useRef(null);
  const timer = useRef(null);

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  useEffect(() => clearTimer, []);

  const resetVisual = () => {
    const el = elementRef.current;
    if (el) {
      el.style.transform = '';
      el.style.transition = '';
    }
  };

  const onPointerDown = useCallback((e) => {
    if (e.pointerType !== 'touch' || e.target.closest('a, button, video')) return;
    gesture.current = { x: e.clientX, y: e.clientY, fired: false, swipe: false };
    clearTimer();
    timer.current = setTimeout(() => {
      if (!gesture.current) return;
      gesture.current.fired = true;
      resetVisual();
      navigator.vibrate?.(12);
      onOpenActions({ x: gesture.current.x, y: gesture.current.y, via: 'touch' });
    }, longPressMs);
  }, [onOpenActions, longPressMs]);

  const onPointerMove = useCallback((e) => {
    const g = gesture.current;
    if (!g || g.fired) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (Math.hypot(dx, dy) > MOVE_TOLERANCE) clearTimer();
    if (dx > 0 && Math.abs(dy) < SWIPE_MAX_DRIFT) {
      g.swipe = dx >= SWIPE_DISTANCE;
      const el = elementRef.current;
      if (el) el.style.transform = `translateX(${Math.min(dx, SWIPE_DISTANCE + 16)}px)`;
    }
  }, []);

  const finish = useCallback((e) => {
    clearTimer();
    const g = gesture.current;
    gesture.current = null;
    const el = elementRef.current;
    if (el) {
      el.style.transition = 'transform 160ms ease-out';
      el.style.transform = '';
      setTimeout(resetVisual, 180);
    }
    if (g && g.swipe && !g.fired && e.type === 'pointerup') onSwipeReply();
  }, [onSwipeReply]);

  const onContextMenu = useCallback((e) => {
    e.preventDefault();
    if (gesture.current?.fired) return; // the long-press timer already opened the sheet
    onOpenActions({ x: e.clientX, y: e.clientY, via: coarse ? 'touch' : 'mouse' });
  }, [onOpenActions, coarse]);

  return {
    ref: elementRef,
    handlers: { onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: finish, onContextMenu },
  };
};
