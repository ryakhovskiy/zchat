package com.zchat.mobile.call

import android.app.Application
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.os.Build
import android.util.Log
import com.zchat.mobile.data.repository.ChatRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.DataChannel
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class CallManager @Inject constructor(
    private val app: Application,
    private val chatRepository: ChatRepository
) {
    companion object {
        private const val TAG = "CallManager"
        private val ICE_SERVERS = listOf(
            PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
            PeerConnection.IceServer.builder("stun:global.stun.twilio.com:3478").createIceServer()
        )
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private val _callState = MutableStateFlow(CallState.Idle)
    val callState: StateFlow<CallState> = _callState.asStateFlow()

    private val _callPeer = MutableStateFlow<CallPeerInfo?>(null)
    val callPeer: StateFlow<CallPeerInfo?> = _callPeer.asStateFlow()

    private val _isMuted = MutableStateFlow(false)
    val isMuted: StateFlow<Boolean> = _isMuted.asStateFlow()

    private val _isSpeakerOn = MutableStateFlow(false)
    val isSpeakerOn: StateFlow<Boolean> = _isSpeakerOn.asStateFlow()

    private val _callDuration = MutableStateFlow(0)
    val callDuration: StateFlow<Int> = _callDuration.asStateFlow()

    private var peerConnectionFactory: PeerConnectionFactory? = null
    private var peerConnection: PeerConnection? = null
    private var localAudioSource: AudioSource? = null
    private var localAudioTrack: AudioTrack? = null
    private var pendingOfferSdp: String? = null
    private var candidateBuffer = mutableListOf<IceCandidate>()
    private var remoteDescriptionSet = false
    private var durationJob: Job? = null
    private val audioManager: AudioManager by lazy {
        app.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    }

    init {
        initPeerConnectionFactory()
        scope.launch {
            chatRepository.callEvents.collect { event -> handleSignalingEvent(event) }
        }
    }

    private fun initPeerConnectionFactory() {
        val options = PeerConnectionFactory.InitializationOptions.builder(app)
            .setFieldTrials("")
            .createInitializationOptions()
        PeerConnectionFactory.initialize(options)

        val eglBase = EglBase.create()
        peerConnectionFactory = PeerConnectionFactory.builder()
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase.eglBaseContext))
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true))
            .createPeerConnectionFactory()
    }

    // ── Public API ──────────────────────────────────────────────────────────────

    fun startCall(targetUserId: Long, targetUsername: String, conversationId: Long) {
        if (_callState.value != CallState.Idle) {
            Log.w(TAG, "Cannot start call: state=${_callState.value}")
            return
        }
        _callPeer.value = CallPeerInfo(targetUserId, targetUsername, conversationId)
        _callState.value = CallState.Outgoing
        startService()

        scope.launch {
            val pc = createPeerConnection() ?: run {
                Log.e(TAG, "Failed to create PeerConnection")
                cleanup()
                return@launch
            }
            peerConnection = pc
            createLocalAudioTrack(pc)

            pc.createOffer(object : SimpleSdpObserver() {
                override fun onCreateSuccess(sdp: SessionDescription) {
                    pc.setLocalDescription(SimpleSdpObserver(), sdp)
                    chatRepository.sendCallOffer(targetUserId, conversationId, sdp.description)
                }
                override fun onCreateFailure(error: String?) {
                    Log.e(TAG, "createOffer failed: $error")
                    cleanup()
                }
            }, MediaConstraints())
        }
    }

    fun acceptCall() {
        if (_callState.value != CallState.Incoming) {
            Log.w(TAG, "Cannot accept call: state=${_callState.value}")
            return
        }
        val peer = _callPeer.value ?: return
        val offerSdp = pendingOfferSdp ?: return
        _callState.value = CallState.Connecting

        scope.launch {
            val pc = createPeerConnection() ?: run {
                Log.e(TAG, "Failed to create PeerConnection")
                cleanup()
                return@launch
            }
            peerConnection = pc
            createLocalAudioTrack(pc)

            val remoteDesc = SessionDescription(SessionDescription.Type.OFFER, offerSdp)
            pc.setRemoteDescription(object : SimpleSdpObserver() {
                override fun onSetSuccess() {
                    remoteDescriptionSet = true
                    flushCandidateBuffer()
                    pc.createAnswer(object : SimpleSdpObserver() {
                        override fun onCreateSuccess(sdp: SessionDescription) {
                            pc.setLocalDescription(SimpleSdpObserver(), sdp)
                            chatRepository.sendCallAnswer(peer.userId, peer.conversationId, sdp.description)
                        }
                        override fun onCreateFailure(error: String?) {
                            Log.e(TAG, "createAnswer failed: $error")
                            cleanup()
                        }
                    }, MediaConstraints())
                }
                override fun onSetFailure(error: String?) {
                    Log.e(TAG, "setRemoteDescription(offer) failed: $error")
                    cleanup()
                }
            }, remoteDesc)
        }
    }

    fun rejectCall() {
        val peer = _callPeer.value ?: return
        chatRepository.sendCallRejected(peer.userId, peer.conversationId)
        cleanup()
    }

    fun endCall() {
        val peer = _callPeer.value
        if (peer != null && _callState.value != CallState.Idle && _callState.value != CallState.Ended) {
            chatRepository.sendCallEnd(peer.userId, peer.conversationId)
        }
        cleanup()
    }

    fun toggleMute() {
        _isMuted.value = !_isMuted.value
        localAudioTrack?.setEnabled(!_isMuted.value)
    }

    fun toggleSpeaker() {
        _isSpeakerOn.value = !_isSpeakerOn.value
        audioManager.isSpeakerphoneOn = _isSpeakerOn.value
    }

    // ── Signaling event handling ────────────────────────────────────────────────

    private fun handleSignalingEvent(event: CallSignalingEvent) {
        when (event) {
            is CallSignalingEvent.Offer -> handleOffer(event)
            is CallSignalingEvent.Answer -> handleAnswer(event)
            is CallSignalingEvent.IceCandidate -> handleIceCandidate(event)
            is CallSignalingEvent.Rejected -> handleRejected()
            is CallSignalingEvent.Ended -> handleEnded()
        }
    }

    private fun handleOffer(event: CallSignalingEvent.Offer) {
        if (_callState.value != CallState.Idle) {
            // Auto-reject if already in a call
            chatRepository.sendCallRejected(event.senderId, event.conversationId)
            return
        }
        _callPeer.value = CallPeerInfo(event.senderId, event.senderUsername, event.conversationId)
        pendingOfferSdp = event.sdp
        _callState.value = CallState.Incoming
        startService()
    }

    private fun handleAnswer(event: CallSignalingEvent.Answer) {
        if (_callState.value != CallState.Outgoing) return
        val pc = peerConnection ?: return
        _callState.value = CallState.Connecting

        val remoteDesc = SessionDescription(SessionDescription.Type.ANSWER, event.sdp)
        pc.setRemoteDescription(object : SimpleSdpObserver() {
            override fun onSetSuccess() {
                remoteDescriptionSet = true
                flushCandidateBuffer()
            }
            override fun onSetFailure(error: String?) {
                Log.e(TAG, "setRemoteDescription(answer) failed: $error")
                cleanup()
            }
        }, remoteDesc)
    }

    private fun handleIceCandidate(event: CallSignalingEvent.IceCandidate) {
        val candidate = IceCandidate(event.sdpMid, event.sdpMLineIndex, event.candidate)
        if (remoteDescriptionSet && peerConnection != null) {
            peerConnection?.addIceCandidate(candidate)
        } else {
            candidateBuffer.add(candidate)
        }
    }

    private fun handleRejected() {
        cleanup()
    }

    private fun handleEnded() {
        cleanup()
    }

    // ── PeerConnection setup ────────────────────────────────────────────────────

    private fun createPeerConnection(): PeerConnection? {
        val config = PeerConnection.RTCConfiguration(ICE_SERVERS).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }
        return peerConnectionFactory?.createPeerConnection(config, object : PeerConnection.Observer {
            override fun onIceCandidate(candidate: IceCandidate) {
                val peer = _callPeer.value ?: return
                chatRepository.sendIceCandidate(
                    peer.userId,
                    peer.conversationId,
                    candidate.sdp,
                    candidate.sdpMLineIndex,
                    candidate.sdpMid
                )
            }

            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) {}

            override fun onAddStream(stream: MediaStream?) {}

            override fun onRemoveStream(stream: MediaStream?) {}

            override fun onDataChannel(dc: DataChannel?) {}

            override fun onRenegotiationNeeded() {}

            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {
                Log.d(TAG, "ICE connection state: $state")
                when (state) {
                    PeerConnection.IceConnectionState.CONNECTED,
                    PeerConnection.IceConnectionState.COMPLETED -> {
                        _callState.value = CallState.Active
                        startDurationTimer()
                        requestAudioFocus()
                    }
                    PeerConnection.IceConnectionState.DISCONNECTED,
                    PeerConnection.IceConnectionState.FAILED,
                    PeerConnection.IceConnectionState.CLOSED -> {
                        cleanup()
                    }
                    else -> {}
                }
            }

            override fun onIceConnectionReceivingChange(receiving: Boolean) {}

            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) {}

            override fun onSignalingChange(state: PeerConnection.SignalingState?) {}

            override fun onConnectionChange(newState: PeerConnection.PeerConnectionState?) {
                Log.d(TAG, "PeerConnection state: $newState")
            }

            override fun onTrack(transceiver: org.webrtc.RtpTransceiver?) {
                // Remote audio track will be played automatically
            }
        })
    }

    private fun createLocalAudioTrack(pc: PeerConnection) {
        val factory = peerConnectionFactory ?: return
        localAudioSource = factory.createAudioSource(MediaConstraints())
        localAudioTrack = factory.createAudioTrack("audio_local", localAudioSource).also {
            it.setEnabled(true)
            pc.addTrack(it)
        }
    }

    private fun flushCandidateBuffer() {
        val pc = peerConnection ?: return
        candidateBuffer.forEach { pc.addIceCandidate(it) }
        candidateBuffer.clear()
    }

    // ── Audio focus ─────────────────────────────────────────────────────────────

    private fun requestAudioFocus() {
        audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
        audioManager.isSpeakerphoneOn = _isSpeakerOn.value
    }

    private fun releaseAudioFocus() {
        audioManager.mode = AudioManager.MODE_NORMAL
        audioManager.isSpeakerphoneOn = false
    }

    // ── Duration timer ──────────────────────────────────────────────────────────

    private fun startDurationTimer() {
        durationJob?.cancel()
        _callDuration.value = 0
        durationJob = scope.launch {
            while (true) {
                delay(1000)
                _callDuration.value += 1
            }
        }
    }

    // ── Service lifecycle ───────────────────────────────────────────────────────

    private fun startService() {
        val intent = Intent(app, CallService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            app.startForegroundService(intent)
        } else {
            app.startService(intent)
        }
    }

    private fun stopService() {
        app.stopService(Intent(app, CallService::class.java))
    }

    // ── Cleanup ─────────────────────────────────────────────────────────────────

    private fun cleanup() {
        durationJob?.cancel()
        durationJob = null

        localAudioTrack?.setEnabled(false)
        localAudioTrack?.dispose()
        localAudioTrack = null

        localAudioSource?.dispose()
        localAudioSource = null

        peerConnection?.close()
        peerConnection = null

        pendingOfferSdp = null
        candidateBuffer.clear()
        remoteDescriptionSet = false

        releaseAudioFocus()

        _callState.value = CallState.Idle
        _callPeer.value = null
        _isMuted.value = false
        _isSpeakerOn.value = false
        _callDuration.value = 0

        stopService()
    }

    // ── SDP observer helper ─────────────────────────────────────────────────────

    private open class SimpleSdpObserver : SdpObserver {
        override fun onCreateSuccess(sdp: SessionDescription) {}
        override fun onSetSuccess() {}
        override fun onCreateFailure(error: String?) {
            Log.e("SimpleSdpObserver", "onCreateFailure: $error")
        }
        override fun onSetFailure(error: String?) {
            Log.e("SimpleSdpObserver", "onSetFailure: $error")
        }
    }
}
