import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCall } from '../../contexts/CallContext';
import { Avatar } from '../Common/Avatar';
import { Icon } from '../Common/Icon';
import './CallModal.css';

/** Call UI: full-screen on phones, a card in the corner from 768px. */
export const CallOverlay = () => {
  const { t } = useTranslation();
  const { callState, callPeer, acceptCall, rejectCall, endCall } = useCall();
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (callState !== 'active') {
      setDuration(0);
      return undefined;
    }
    const interval = setInterval(() => setDuration((d) => d + 1), 1000);
    return () => clearInterval(interval);
  }, [callState]);

  if (callState === 'idle') return null;

  const formatDuration = (secs) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const statusLabel = {
    incoming: t('call.incoming'),
    calling: t('call.calling'),
    active: t('call.in_call'),
    rejected: t('call.decline'),
  }[callState];

  return (
    <div
      className="call-overlay"
      role={callState === 'incoming' ? 'alertdialog' : 'dialog'}
      aria-modal="true"
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
              <button type="button" className="call-btn accept" onClick={acceptCall} data-testid="call-accept">
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
            <button type="button" className="call-btn end" onClick={() => endCall()} data-testid="call-end">
              <span className="call-btn-icon"><Icon name="phone-off" size={28} /></span>
              <span className="call-btn-label">{t('call.end')}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
