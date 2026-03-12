package com.zchat.mobile.feature.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zchat.mobile.data.remote.dto.ConversationDto
import com.zchat.mobile.data.remote.dto.MessageDto
import com.zchat.mobile.data.remote.dto.UserDto
import com.zchat.mobile.data.repository.ApiResult
import com.zchat.mobile.data.repository.ChatRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ConversationListState(
    val loading: Boolean = false,
    val conversations: List<ConversationDto> = emptyList(),
    val wsConnected: Boolean = false,
    val error: String? = null
)

data class NewConversationState(
    val users: List<UserDto> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null
)

@HiltViewModel
class ConversationListViewModel @Inject constructor(
    private val chatRepository: ChatRepository
) : ViewModel() {

    private val _listState = MutableStateFlow(ConversationListState())
    val listState: StateFlow<ConversationListState> = _listState.asStateFlow()

    private val _newState = MutableStateFlow(NewConversationState())
    val newState: StateFlow<NewConversationState> = _newState.asStateFlow()

    private val _navigateToConversation = MutableSharedFlow<Long>(extraBufferCapacity = 1)
    val navigateToConversation: SharedFlow<Long> = _navigateToConversation.asSharedFlow()

    init {
        viewModelScope.launch {
            chatRepository.wsConnected.collect { connected ->
                _listState.update { it.copy(wsConnected = connected) }
            }
        }
        viewModelScope.launch {
            chatRepository.wsEvents.collect { event -> processWsEvent(event) }
        }
    }

    // ── Realtime ───────────────────────────────────────────────────────────────

    fun connectRealtime(token: String?) {
        if (token.isNullOrBlank()) return
        chatRepository.connectRealtime(token)
    }

    fun disconnectRealtime() = chatRepository.disconnectRealtime()

    // ── WS event handling (list-relevant events) ───────────────────────────────

    private fun processWsEvent(event: Map<String, Any?>) {
        when (event["type"] as? String) {
            "message" -> {
                val msg = wsEventToMessage(event) ?: return
                _listState.update { state ->
                    state.copy(
                        conversations = state.conversations.map { conv ->
                            if (conv.id == msg.conversationId)
                                conv.copy(
                                    lastMessage = msg,
                                    updatedAt = msg.displayTime,
                                    unreadCount = (conv.unreadCount ?: 0) + 1
                                )
                            else conv
                        }
                    )
                }
            }
            "messages_read" -> {
                val convId = (event["conversation_id"] as? Double)?.toLong() ?: return
                _listState.update { state ->
                    state.copy(conversations = state.conversations.map { c ->
                        if (c.id == convId) c.copy(unreadCount = 0) else c
                    })
                }
            }
            "user_online" -> {
                val userId = (event["user_id"] as? Double)?.toLong() ?: return
                _newState.update { state ->
                    state.copy(users = state.users.map { u -> if (u.id == userId) u.copy(isOnline = true) else u })
                }
            }
            "user_offline" -> {
                val userId = (event["user_id"] as? Double)?.toLong() ?: return
                _newState.update { state ->
                    state.copy(users = state.users.map { u -> if (u.id == userId) u.copy(isOnline = false) else u })
                }
            }
        }
    }

    // ── Conversations ──────────────────────────────────────────────────────────

    fun loadConversations() {
        viewModelScope.launch {
            _listState.update { it.copy(loading = true, error = null) }
            when (val result = chatRepository.getConversations()) {
                is ApiResult.Success -> _listState.update { it.copy(loading = false, conversations = result.data) }
                is ApiResult.Error -> _listState.update { it.copy(loading = false, error = result.message) }
            }
        }
    }

    fun createConversation(participantIds: List<Long>, isGroup: Boolean, name: String?) {
        viewModelScope.launch {
            when (val result = chatRepository.createConversation(participantIds, isGroup, name)) {
                is ApiResult.Success -> {
                    _listState.update { it.copy(conversations = it.conversations + result.data) }
                    _navigateToConversation.emit(result.data.id)
                }
                is ApiResult.Error -> _newState.update { it.copy(error = result.message) }
            }
        }
    }

    fun resetUnread(conversationId: Long) {
        _listState.update { state ->
            state.copy(conversations = state.conversations.map { c ->
                if (c.id == conversationId) c.copy(unreadCount = 0) else c
            })
        }
    }

    // ── Users (for NewConversationScreen) ──────────────────────────────────────

    fun loadUsers() {
        viewModelScope.launch {
            _newState.update { it.copy(loading = true) }
            when (val result = chatRepository.getUsers()) {
                is ApiResult.Success -> _newState.update { it.copy(loading = false, users = result.data) }
                is ApiResult.Error -> _newState.update { it.copy(loading = false, error = result.message) }
            }
        }
    }

    fun clearError() {
        _listState.update { it.copy(error = null) }
        _newState.update { it.copy(error = null) }
    }

    private fun wsEventToMessage(event: Map<String, Any?>): MessageDto? {
        val id = (event["message_id"] as? Double)?.toLong() ?: return null
        val convId = (event["conversation_id"] as? Double)?.toLong() ?: return null
        return MessageDto(
            id = id,
            conversationId = convId,
            content = event["content"] as? String ?: "",
            senderId = (event["sender_id"] as? Double)?.toLong() ?: 0L,
            senderUsername = event["sender_username"] as? String,
            filePath = event["file_path"] as? String,
            fileType = event["file_type"] as? String,
            createdAt = event["timestamp"] as? String,
            isRead = event["is_read"] as? Boolean,
            isEdited = event["is_edited"] as? Boolean,
            isDeleted = event["is_deleted"] as? Boolean,
        )
    }
}
