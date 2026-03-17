package com.zchat.mobile.data.repository

import com.zchat.mobile.call.CallSignalingEvent
import com.zchat.mobile.data.remote.api.ConversationsApi
import com.zchat.mobile.data.remote.api.FilesApi
import com.zchat.mobile.data.remote.api.MessagesApi
import com.zchat.mobile.data.remote.api.UsersApi
import com.zchat.mobile.data.remote.dto.ConversationDto
import com.zchat.mobile.data.remote.dto.CreateConversationRequestDto
import com.zchat.mobile.data.remote.dto.EditMessageRequestDto
import com.zchat.mobile.data.remote.dto.MessageDto
import com.zchat.mobile.data.remote.dto.SendMessageRequestDto
import com.zchat.mobile.data.remote.dto.UploadResponseDto
import com.zchat.mobile.data.remote.dto.UserDto
import com.zchat.mobile.data.remote.network.ZChatWebSocketClient
import android.util.Log
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import okhttp3.MultipartBody
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ChatRepository @Inject constructor(
    private val conversationsApi: ConversationsApi,
    private val usersApi: UsersApi,
    private val messagesApi: MessagesApi,
    private val filesApi: FilesApi,
    private val webSocketClient: ZChatWebSocketClient
) {
    val wsConnected = webSocketClient.connected
    val wsConnectionFailed = webSocketClient.connectionFailed
    val wsEvents = webSocketClient.events

    private val _callEvents = MutableSharedFlow<CallSignalingEvent>(extraBufferCapacity = 16)
    val callEvents: SharedFlow<CallSignalingEvent> = _callEvents.asSharedFlow()

    fun emitCallEvent(event: CallSignalingEvent) {
        _callEvents.tryEmit(event)
    }

    // ── Conversations ──────────────────────────────────────────────────────────
    suspend fun getConversations(): ApiResult<List<ConversationDto>> =
        apiCall { conversationsApi.listConversations() }

    suspend fun createConversation(participantIds: List<Long>, isGroup: Boolean, name: String?): ApiResult<ConversationDto> =
        apiCall { conversationsApi.createConversation(CreateConversationRequestDto(participantIds, isGroup, name)) }

    // ── Messages ───────────────────────────────────────────────────────────────
    suspend fun getMessages(conversationId: Long, limit: Int = 100): ApiResult<List<MessageDto>> =
        apiCall { conversationsApi.listMessages(conversationId, limit) }

    suspend fun sendMessage(conversationId: Long, content: String): ApiResult<MessageDto?> =
        sendMessageWithFile(conversationId, content, null, null)

    suspend fun sendMessageWithFile(
        conversationId: Long,
        content: String,
        filePath: String?,
        fileType: String?
    ): ApiResult<MessageDto?> {
        return if (wsConnected.value) {
            webSocketClient.send(
                mapOf(
                    "type" to "message",
                    "conversation_id" to conversationId,
                    "content" to content,
                    "file_path" to filePath,
                    "file_type" to fileType
                ).filterValues { it != null }
            )
            ApiResult.Success(null)
        } else {
            apiCall {
                conversationsApi.sendMessage(conversationId, SendMessageRequestDto(content, filePath, fileType))
            }
        }
    }

    suspend fun editMessage(messageId: Long, content: String): ApiResult<MessageDto> =
        apiCall { messagesApi.editMessage(messageId, EditMessageRequestDto(content)) }

    suspend fun deleteMessage(messageId: Long, deleteType: String = "for_everyone"): ApiResult<MessageDto> =
        apiCall { messagesApi.deleteMessage(messageId, deleteType) }

    suspend fun markRead(conversationId: Long) {
        runCatching { conversationsApi.markAsRead(conversationId) }
            .onFailure { Log.w("ChatRepository", "markRead failed for conversation $conversationId", it) }
        webSocketClient.send(mapOf("type" to "mark_read", "conversation_id" to conversationId))
    }

    fun sendTyping(conversationId: Long) {
        if (wsConnected.value) {
            webSocketClient.send(mapOf("type" to "typing", "conversation_id" to conversationId))
        }
    }

    fun sendCallRejected(targetUserId: Long, conversationId: Long) {
        if (wsConnected.value) {
            webSocketClient.send(
                mapOf(
                    "type" to "call_rejected",
                    "target_user_id" to targetUserId,
                    "conversation_id" to conversationId
                )
            )
        }
    }

    fun sendCallOffer(targetUserId: Long, conversationId: Long, sdp: String) {
        if (wsConnected.value) {
            webSocketClient.send(
                mapOf(
                    "type" to "call_offer",
                    "target_user_id" to targetUserId,
                    "conversation_id" to conversationId,
                    "sdp" to mapOf("type" to "offer", "sdp" to sdp)
                )
            )
        }
    }

    fun sendCallAnswer(targetUserId: Long, conversationId: Long, sdp: String) {
        if (wsConnected.value) {
            webSocketClient.send(
                mapOf(
                    "type" to "call_answer",
                    "target_user_id" to targetUserId,
                    "conversation_id" to conversationId,
                    "sdp" to mapOf("type" to "answer", "sdp" to sdp)
                )
            )
        }
    }

    fun sendIceCandidate(targetUserId: Long, conversationId: Long, candidate: String, sdpMLineIndex: Int, sdpMid: String?) {
        if (wsConnected.value) {
            webSocketClient.send(
                mapOf(
                    "type" to "ice_candidate",
                    "target_user_id" to targetUserId,
                    "conversation_id" to conversationId,
                    "candidate" to mapOf(
                        "candidate" to candidate,
                        "sdpMLineIndex" to sdpMLineIndex,
                        "sdpMid" to sdpMid
                    )
                )
            )
        }
    }

    fun sendCallEnd(targetUserId: Long, conversationId: Long) {
        if (wsConnected.value) {
            webSocketClient.send(
                mapOf(
                    "type" to "call_end",
                    "target_user_id" to targetUserId,
                    "conversation_id" to conversationId
                )
            )
        }
    }

    // ── Files ──────────────────────────────────────────────────────────────────
    suspend fun uploadFile(part: MultipartBody.Part): ApiResult<UploadResponseDto> =
        apiCall { filesApi.upload(part) }

    // ── Users ──────────────────────────────────────────────────────────────────
    suspend fun getUsers(): ApiResult<List<UserDto>> =
        apiCall { usersApi.listUsers() }

    suspend fun getOnlineUsers(): ApiResult<List<UserDto>> =
        apiCall { usersApi.listOnlineUsers() }

    // ── Realtime ───────────────────────────────────────────────────────────────
    fun connectRealtime(token: String) = webSocketClient.connect(token)

    fun disconnectRealtime() = webSocketClient.disconnect()
}