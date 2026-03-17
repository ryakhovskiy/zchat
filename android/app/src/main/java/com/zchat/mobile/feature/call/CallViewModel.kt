package com.zchat.mobile.feature.call

import androidx.lifecycle.ViewModel
import com.zchat.mobile.call.CallManager
import com.zchat.mobile.call.CallPeerInfo
import com.zchat.mobile.call.CallState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import javax.inject.Inject

@HiltViewModel
class CallViewModel @Inject constructor(
    private val callManager: CallManager
) : ViewModel() {

    val callState: StateFlow<CallState> = callManager.callState
    val callPeer: StateFlow<CallPeerInfo?> = callManager.callPeer
    val isMuted: StateFlow<Boolean> = callManager.isMuted
    val isSpeakerOn: StateFlow<Boolean> = callManager.isSpeakerOn
    val callDuration: StateFlow<Int> = callManager.callDuration

    fun acceptCall() = callManager.acceptCall()
    fun rejectCall() = callManager.rejectCall()
    fun endCall() = callManager.endCall()
    fun toggleMute() = callManager.toggleMute()
    fun toggleSpeaker() = callManager.toggleSpeaker()
}
