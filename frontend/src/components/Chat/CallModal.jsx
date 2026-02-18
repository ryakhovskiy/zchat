import React, { useEffect, useState } from 'react';
import { useCall } from '../../contexts/CallContext';
import './CallModal.css';

export const CallOverlay = () => {
    const { callState, callPeer, acceptCall, rejectCall, endCall } = useCall();
    const [duration, setDuration] = useState(0);

    useEffect(() => {
        let interval;
        if (callState === 'active') {
            interval = setInterval(() => {
                setDuration(d => d + 1);
            }, 1000);
        } else {
            setDuration(0);
        }
        return () => clearInterval(interval);
    }, [callState]);

    const formatDuration = (secs) => {
        const mins = Math.floor(secs / 60);
        const seconds = secs % 60;
        return `${mins}:${seconds.toString().padStart(2, '0')}`;
    };

    if (callState === 'idle') return null;

    return (
        <div className="call-overlay">
            <div className="call-card">
                <div className="call-status">
                    {callState === 'incoming' && 'Incoming Call'}
                    {callState === 'calling' && 'Calling...'}
                    {callState === 'active' && 'In Call'}
                </div>
                
                <div className="call-peer">
                    <div className="peer-avatar">
                        {callPeer?.username?.charAt(0).toUpperCase()}
                    </div>
                    <div className="peer-name">{callPeer?.username}</div>
                </div>

                {callState === 'active' && (
                    <div className="call-timer">{formatDuration(duration)}</div>
                )}

                <div className="call-actions">
                    {callState === 'incoming' && (
                        <>
                            <button className="call-btn accept" onClick={acceptCall}>
                                📞 Accept
                            </button>
                            <button className="call-btn reject" onClick={rejectCall}>
                                ❌ Decline
                            </button>
                        </>
                    )}

                    {(callState === 'calling' || callState === 'active') && (
                        <button className="call-btn end" onClick={() => endCall()}>
                             ❌ End Call
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
