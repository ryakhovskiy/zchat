import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';

const CallContext = createContext(null);

export const useCall = () => {
    const context = useContext(CallContext);
    if (!context) {
        throw new Error('useCall must be used within CallProvider');
    }
    return context;
};

const STUN_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
    ]
};

export const CallProvider = ({ children }) => {
    const { user, wsClient } = useAuth();
    const [callState, setCallState] = useState('idle'); // idle, calling, incoming, active, rejected
    const [remoteStream, setRemoteStream] = useState(null);
    const [localStream, setLocalStream] = useState(null);
    const [callPeer, setCallPeer] = useState(null); // The other person (caller or callee)
    const [incomingSDP, setIncomingSDP] = useState(null);
    
    // Use refs for mutable values that don't need to trigger re-renders directly or inside callbacks
    const peerConnection = useRef(null);
    const localStreamRef = useRef(null);
    
    // Cleanup on unmount or user change
    useEffect(() => {
        return () => {
            endCall();
        };
    }, [user]);

    // WebSocket event listeners
    useEffect(() => {
        if (!wsClient) return;

        const handleCallOffer = (data) => {
            if (callState !== 'idle') {
                 // Already in a call, auto-reject
                 wsClient.send({
                    type: 'call_rejected', 
                    target_user_id: data.sender_id,
                    conversation_id: data.conversation_id
                });
                return;
            }
            
            setCallPeer({ id: data.sender_id, username: data.sender_username, conversationId: data.conversation_id });
            setIncomingSDP(data.sdp);
            setCallState('incoming');
        };

        const handleCallAnswer = async (data) => {
            if (callState === 'calling' && peerConnection.current) {
                try {
                    await peerConnection.current.setRemoteDescription(new RTCSessionDescription(data.sdp));
                    setCallState('active');
                } catch (err) {
                    console.error("Error handling call answer", err);
                }
            }
        };

        const handleIceCandidate = async (data) => {
             // If we have a PC and it has a remote description, add candidate
             // Otherwise queue it? For simplicity, we assume signaling is fast enough 
             // or we rely on STUN/TURN gathering completing eventually.
            if (peerConnection.current && peerConnection.current.remoteDescription && data.candidate) {
                try {
                    await peerConnection.current.addIceCandidate(new RTCIceCandidate(data.candidate));
                } catch (err) {
                    console.error("Error adding ice candidate", err);
                }
            }
        };
        
        const handleCallEnd = () => {
             cleanupCall();
        };
        
        const handleCallRejected = () => {
            alert("Call rejected");
            cleanupCall();
        };

        wsClient.on('call_offer', handleCallOffer);
        wsClient.on('call_answer', handleCallAnswer);
        wsClient.on('ice_candidate', handleIceCandidate);
        wsClient.on('call_end', handleCallEnd);
        wsClient.on('call_rejected', handleCallRejected);

        return () => {
            wsClient.off('call_offer', handleCallOffer);
            wsClient.off('call_answer', handleCallAnswer);
            wsClient.off('ice_candidate', handleIceCandidate);
            wsClient.off('call_end', handleCallEnd);
            wsClient.off('call_rejected', handleCallRejected);
        };
    }, [wsClient, callState]); // Re-bind if callState changes to ensure current state is checked

    const createPeerConnection = (targetUserId, conversationId) => {
        const pc = new RTCPeerConnection(STUN_SERVERS);

        pc.onicecandidate = (event) => {
            if (event.candidate && wsClient) {
                wsClient.send({
                    type: 'ice_candidate',
                    target_user_id: targetUserId,
                    conversation_id: conversationId,
                    candidate: event.candidate
                });
            }
        };

        pc.ontrack = (event) => {
            console.log("Received remote track", event.streams[0]);
            setRemoteStream(event.streams[0]);
        };
        
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                cleanupCall();
            }
        };

        return pc;
    };

    const startCall = async (targetUserId, targetUsername, conversationId) => {
        if (!wsClient) {
             alert("Connection error");
             return;
        }
        if (!conversationId) {
            alert("Conversation context is required to start a call");
            return;
        }
        try {
            setCallPeer({ id: targetUserId, username: targetUsername, conversationId });
            setCallState('calling');

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            setLocalStream(stream);
            localStreamRef.current = stream;

            const pc = createPeerConnection(targetUserId, conversationId);
            peerConnection.current = pc;

            stream.getTracks().forEach(track => pc.addTrack(track, stream));

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            wsClient.send({
                type: 'call_offer',
                target_user_id: targetUserId,
                conversation_id: conversationId,
                sdp: offer
            });
        } catch (err) {
            console.error("Error starting call:", err);
            cleanupCall();
            alert(`Could not start call: ${err.message}`);
        }
    };

    const acceptCall = async () => {
        if (!callPeer || !incomingSDP) return;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            setLocalStream(stream);
            localStreamRef.current = stream;

            const pc = createPeerConnection(callPeer.id, callPeer.conversationId);
            peerConnection.current = pc;

            stream.getTracks().forEach(track => pc.addTrack(track, stream));
            
            await pc.setRemoteDescription(new RTCSessionDescription(incomingSDP));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            setCallState('active');

            wsClient.send({
                type: 'call_answer',
                target_user_id: callPeer.id,
                conversation_id: callPeer.conversationId,
                sdp: answer
            });
        } catch (err) {
            console.error("Error accepting call:", err);
            cleanupCall();
        }
    };

    const rejectCall = () => {
        if (callPeer && wsClient) {
            wsClient.send({
                type: 'call_rejected',
                target_user_id: callPeer.id,
                conversation_id: callPeer.conversationId
            });
        }
        cleanupCall();
    };

    const endCall = () => {
        if (callPeer && wsClient && callState !== 'idle') {
             wsClient.send({
                type: 'call_end',
                target_user_id: callPeer.id,
                conversation_id: callPeer.conversationId
            });
        }
        cleanupCall();
    };
    
    const cleanupCall = () => {
        if (peerConnection.current) {
            peerConnection.current.close();
            peerConnection.current = null;
        }

        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => track.stop());
            localStreamRef.current = null;
        }

        setLocalStream(null);
        setRemoteStream(null);
        setCallState('idle');
        setCallPeer(null);
        setIncomingSDP(null);
    };

    return (
        <CallContext.Provider value={{
            callState,
            localStream,
            remoteStream,
            callPeer,
            startCall,
            acceptCall,
            rejectCall,
            endCall
        }}>
            {children}
            {/* Hidden audio element for remote stream */}
            {remoteStream && (
                <audio
                    autoPlay
                    ref={audio => {
                        if (audio) {
                            audio.srcObject = remoteStream;
                            audio.play().catch(e => console.error("Audio play error", e));
                        }
                    }}
                />
            )}
        </CallContext.Provider>
    );
};
