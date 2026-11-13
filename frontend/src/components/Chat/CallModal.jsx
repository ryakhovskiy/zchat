import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCall } from '../../contexts/CallContext';
import { useCoarsePointer, useIsPhone } from '../../hooks/useMediaQuery';
import { trapTab } from '../../utils/focus';
import { Avatar } from '../Common/Avatar';
import { Icon } from '../Common/Icon';
import './CallModal.css';

/** Call UI: full-screen on phones, a card in the corner from 768px. */
export const CallOverlay = () => {
  const { t } = useTranslation();
  const { callState, callPeer, acceptCall, rejectCall, endCall } = useCall();
  const isPhone = useIsPhone();
  const coarse = useCoarsePointer();
  const [duration, setDuration] = useState(0);
  const overlayRef = useRef(null);
  const previousStateRef = useRef('idle');
  const restoreFocusRef = useRef(null);
  const active = callState !== 'idle';

  useEffect(() => {
    if (callState !== 'active') {
      setDuration(0);
      return undefined;
    }
    const interval = setInterval(() => setDuration((d) => d + 1), 1000);
    return () => clearInterval(interval);
  }, [callState]);

  // Focus lifecycle. Phone: the call is a full-screen modal, so focus moves into it and stays there.
  // Desktop: a non-modal corner card (chatting behind it stays possible) that still takes focus.
  useEffect(() => {
    const previous = previousStateRef.current;
    previousStateRef.current = callState;

    if (!active) {
      const target = restoreFocusRef.current;
      restoreFocusRef.current = null;
      // Don't pop the on-screen keyboard back up on touch devices
      const isTextField = target && /^(INPUT|TEXTAREA)$/.test(target.tagName);
      if (target && document.contains(target) && !(coarse && isTextField)) {
        target.focus({ preventScroll: true });
      }
      return;
    }

    if (previous === 'idle') restoreFocusRef.current = document.activeElement;
    // Every call state needs an answer or a way out (Accept/Decline, End), so focus goes to the
    // primary control; this is also what lets Esc work for an outgoing call on desktop
    overlayRef.current?.querySelector('[data-primary]')?.focus({ preventScroll: true });
  }, [callState, active, isPhone, coarse]);

  const onKeyDown = (e) => {
    if (e.key === 'Tab' && isPhone && overlayRef.current) {
      trapTab(e, overlayRef.current);
    } else if (e.key === 'Escape') {
      // Decline an incoming call or cancel an outgoing one. An active call is never ended by a
      // stray Esc: hanging up needs the explicit End button.
      if (callState === 'incoming') {
        e.preventDefault();
        rejectCall();
      } else if (callState === 'calling') {
        e.preventDefault();
        endCall();
      }
    }
  };

  if (!active) return null;

  const formatDuration = (secs) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const statusLabel = {
    incoming: t('call.incoming'),
    calling: t('call.calling'),
    active: t('call.in_call'),
    rejected: t('call.decline'),
  }[callState];

  return (
    <div
      ref={overlayRef}
      className="call-overlay"
      role={callState === 'incoming' ? 'alertdialog' : 'dialog'}
      aria-modal={isPhone ? 'true' : 'false'}
      onKeyDown={onKeyDown}
      aria-label={`${statusLabel}: ${callPeer?.username || ''}`}
      data-testid="call-overlay"
      data-call-state={callState}
    >
      <div className="call-card">
        <div className="call-status" role="status">{statusLabel}</div>

        <div className="call-peer">
          <Avatar name={callPeer?.username || ''} size="xl" className="peer-avatar" />
          <div className="peer-name">{callPeer?.username}</div>
        </div>

        {callState === 'active' && <div className="call-timer" aria-live="off">{formatDuration(duration)}</div>}

        <div className="call-actions">
          {callState === 'incoming' && (
            <>
              <button type="button" className="call-btn accept" onClick={acceptCall} data-testid="call-accept" data-primary>
                <span className="call-btn-icon"><Icon name="phone" size={28} /></span>
                <span className="call-btn-label">{t('call.accept')}</span>
              </button>
              <button type="button" className="call-btn reject" onClick={rejectCall} data-testid="call-decline">
                <span className="call-btn-icon"><Icon name="phone-off" size={28} /></span>
                <span className="call-btn-label">{t('call.decline')}</span>
              </button>
            </>
          )}

          {(callState === 'calling' || callState === 'active') && (
            <button type="button" className="call-btn end" onClick={() => endCall()} data-testid="call-end" data-primary>
              <span className="call-btn-icon"><Icon name="phone-off" size={28} /></span>
              <span className="call-btn-label">{t('call.end')}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
