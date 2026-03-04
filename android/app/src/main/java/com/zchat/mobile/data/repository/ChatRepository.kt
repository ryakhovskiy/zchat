package com.zchat.mobile.data.repository

import com.zchat.mobile.data.remote.api.ConversationsApi
import com.zchat.mobile.data.remote.api.MessagesApi
import com.zchat.mobile.data.remote.api.UsersApi
import com.zchat.mobile.data.remote.dto.ConversationDto
import com.zchat.mobile.data.remote.dto.CreateConversationRequestDto
import com.zchat.mobile.data.remote.dto.EditMessageRequestDto
import com.zchat.mobile.data.remote.dto.MessageDto
import com.zchat.mobile.data.remote.dto.SendMessageRequestDto
import com.zchat.mobile.data.remote.dto.UserDto
import com.zchat.mobile.data.remote.network.ZChatWebSocketClient
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ChatRepository @Inject constructor(
    private val conversationsApi: ConversationsApi,
    private val usersApi: UsersApi,
    private val messagesApi: MessagesApi,
    private val webSocketClient: ZChatWebSocketClient
) {
    val wsConnected = webSocketClient.connected
    val wsEvents = webSocketClient.events

    // ── Conversations ──────────────────────────────────────────────────────────
    suspend fun getConversations(): List<ConversationDto> =
        conversationsApi.listConversations()

    suspend fun createConversation(participantIds: List<Long>, isGroup: Boolean, name: String?): ConversationDto =
        conversationsApi.createConversation(CreateConversationRequestDto(participantIds, isGroup, name))

    // ── Messages ───────────────────────────────────────────────────────────────
    suspend fun getMessages(conversationId: Long, limit: Int = 100): List<MessageDto> =
        conversationsApi.listMessages(conversationId, limit)

    suspend fun sendMessage(conversationId: Long, content: String): MessageDto? {
        return if (wsConnected.value) {
            webSocketClient.send(
                mapOf(
                    "type" to "message",
                    "conversation_id" to conversationId,
                    "content" to content
                )
            )
            null // message will arrive via WS event
        } else {
            conversationsApi.sendMessage(conversationId, SendMessageRequestDto(content))
        }
    }

    suspend fun editMessage(messageId: Long, content: String): MessageDto =
        messagesApi.editMessage(messageId, EditMessageRequestDto(content))

    suspend fun deleteMessage(messageId: Long, deleteType: String = "for_everyone") =
        messagesApi.deleteMessage(messageId, deleteType)

    suspend fun markRead(conversationId: Long) {
        runCatching { conversationsApi.markAsRead(conversationId) }
        webSocketClient.send(mapOf("type" to "mark_read", "conversation_id" to conversationId))
    }

    // ── Users ──────────────────────────────────────────────────────────────────
    suspend fun getUsers(): List<UserDto> = usersApi.listUsers()

    suspend fun getOnlineUsers(): List<UserDto> = usersApi.listOnlineUsers()

    // ── Realtime ───────────────────────────────────────────────────────────────
    fun connectRealtime(token: String) = webSocketClient.connect(token)

    fun disconnectRealtime() = webSocketClient.disconnect()
}