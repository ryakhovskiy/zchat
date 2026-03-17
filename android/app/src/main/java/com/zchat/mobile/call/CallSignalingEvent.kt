package com.zchat.mobile.call

sealed class CallSignalingEvent {
    data class Offer(
        val senderId: Long,
        val senderUsername: String,
        val conversationId: Long,
        val sdp: String
    ) : CallSignalingEvent()

    data class Answer(
        val senderId: Long,
        val conversationId: Long,
        val sdp: String
    ) : CallSignalingEvent()

    data class IceCandidate(
        val senderId: Long,
        val conversationId: Long,
        val candidate: String,
        val sdpMLineIndex: Int,
        val sdpMid: String?
    ) : CallSignalingEvent()

    data class Rejected(
        val senderId: Long,
        val conversationId: Long
    ) : CallSignalingEvent()

    data class Ended(
        val senderId: Long,
        val conversationId: Long
    ) : CallSignalingEvent()
}
