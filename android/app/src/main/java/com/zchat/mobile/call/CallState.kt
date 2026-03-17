package com.zchat.mobile.call

enum class CallState {
    Idle,
    Outgoing,
    Incoming,
    Connecting,
    Active,
    Ended
}

data class CallPeerInfo(
    val userId: Long,
    val username: String,
    val conversationId: Long
)
