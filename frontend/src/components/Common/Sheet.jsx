import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useIsPhone } from '../../hooks/useMediaQuery';
import { Icon } from './Icon';
import './Sheet.css';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Open sheets, topmost last: Esc only closes the topmost one
const stack = [];

const POPOVER_WIDTH = 360;

/**
 * Overlay primitive. Phone (<768px): bottom sheet (or full screen with size="full").
 * Larger screens: popover under `anchorRef` if given, otherwise a centred modal.
 * Closes with the X, a scrim tap or Esc. Traps focus and restores it on close.
 *
 * Props: open, onClose, title, children, anchorRef, size ('auto' | 'tall' | 'full'),
 *        hideHeader, className, testId, footer
 */
export const Sheet = ({
  open,
  onClose,
  title,
  children,
  footer,
  anchorRef,
  size = 'auto',
  hideHeader = false,
  className = '',
  testId,
  ariaLabel,
}) => {
  const { t } = useTranslation();
  const isPhone = useIsPhone();
  const panelRef = useRef(null);
  const titleId = useId();
  const [position, setPosition] = useState(null);
  const popover = !isPhone && !!anchorRef;

  // Anchor the popover under its trigger (clamped to the viewport)
  useLayoutEffect(() => {
    if (!open || !popover) {
      setPosition(null);
      return undefined;
    }
    const place = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(POPOVER_WIDTH, window.innerWidth - 16);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      setPosition({ top: rect.bottom + 8, left, width });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, popover, anchorRef]);

  // Focus management and Esc/Tab handling
  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement;
    const token = {};
    stack.push(token);

    const panel = panelRef.current;
    const first = panel?.querySelector('[data-autofocus]') || panel?.querySelector(FOCUSABLE);
    (first || panel)?.focus({ preventScroll: true });

    const onKeyDown = (e) => {
      if (stack[stack.length - 1] !== token) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const items = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      const index = stack.indexOf(token);
      if (index >= 0) stack.splice(index, 1);
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus?.({ preventScroll: true });
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  const mode = isPhone ? (size === 'full' ? 'fullscreen' : 'bottom') : popover ? 'popover' : 'modal';
  const style = popover && position ? { top: position.top, left: position.left, width: position.width } : undefined;

  return createPortal(
    <div className={`sheet-root sheet-root--${mode}`} data-testid={testId ? `${testId}-root` : undefined}>
      <div className="sheet-scrim" onClick={onClose} data-testid="sheet-scrim" />
      <div
        ref={panelRef}
        className={`sheet-panel sheet-panel--${mode} sheet-panel--${size} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title && !hideHeader ? titleId : undefined}
        aria-label={!title || hideHeader ? ariaLabel : undefined}
        tabIndex={-1}
        style={style}
        data-testid={testId}
      >
        {mode === 'bottom' && <span className="sheet-grabber" aria-hidden="true" />}
        {!hideHeader && (
          <div className="sheet-header">
            <h2 id={titleId} className="sheet-title">{title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label={t('common.close')} data-testid="sheet-close">
              <Icon name="close" />
            </button>
          </div>
        )}
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-footer">{footer}</div>}
      </div>
    </div>,
    document.body
  );
};
