package com.zchat.mobile.data.repository

import com.zchat.mobile.data.remote.api.ConversationsApi
import com.zchat.mobile.data.remote.dto.ConversationDto
import com.zchat.mobile.data.remote.dto.MessageDto
import com.zchat.mobile.data.remote.dto.SendMessageRequestDto
import com.zchat.mobile.data.remote.network.ZChatWebSocketClient
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ChatRepository @Inject constructor(
    private val conversationsApi: ConversationsApi,
    private val webSocketClient: ZChatWebSocketClient
) {
    val wsConnected = webSocketClient.connected
    val wsEvents = webSocketClient.events

    suspend fun getConversations(): List<ConversationDto> = conversationsApi.listConversations()

    suspend fun getMessages(conversationId: Long, limit: Int = 1000): List<MessageDto> =
        conversationsApi.listMessages(conversationId, limit)

    suspend fun markRead(conversationId: Long) {
        conversationsApi.markAsRead(conversationId)
        webSocketClient.send(
            mapOf(
                "type" to "mark_read",
                "conversation_id" to conversationId
            )
        )
    }

    suspend fun sendMessage(conversationId: Long, content: String) {
        if (wsConnected.value) {
            webSocketClient.send(
                mapOf(
                    "type" to "message",
                    "conversation_id" to conversationId,
                    "content" to content
                )
            )
        } else {
            conversationsApi.sendMessage(conversationId, SendMessageRequestDto(content))
        }
    }

    fun connectRealtime(token: String) {
        webSocketClient.connect(token)
    }

    fun disconnectRealtime() {
        webSocketClient.disconnect()
    }
}