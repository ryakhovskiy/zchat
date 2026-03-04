package com.zchat.mobile.feature.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import com.zchat.mobile.data.remote.dto.ConversationDto
import com.zchat.mobile.data.remote.dto.MessageDto
import com.zchat.mobile.data.remote.dto.UserDto
import com.zchat.mobile.data.repository.ChatRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ChatUiState(
    val loading: Boolean = false,
    val conversations: List<ConversationDto> = emptyList(),
    val messages: Map<Long, List<MessageDto>> = emptyMap(),
    val activeConversationId: Long? = null,
    val composingText: String = "",
    val editingMessage: MessageDto? = null,
    val wsConnected: Boolean = false,
    val error: String? = null,
    val users: List<UserDto> = emptyList(),
    val usersLoading: Boolean = false,
    val messagesLoading: Boolean = false,
    val isSending: Boolean = false,
)

@HiltViewModel
class ChatViewModel @Inject constructor(
    private val chatRepository: ChatRepository,
    private val moshi: Moshi
) : ViewModel() {

    private val _uiState = MutableStateFlow(ChatUiState())
    val uiState: StateFlow<ChatUiState> = _uiState.asStateFlow()

    private val messageAdapter = moshi.adapter(MessageDto::class.java)
    private val mapAdapter = moshi.adapter<Map<String, Any?>>(
        Types.newParameterizedType(Map::class.java, String::class.java, Any::class.java)
    )

    init {
        viewModelScope.launch {
            chatRepository.wsConnected.collect { connected ->
                _uiState.update { it.copy(wsConnected = connected) }
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

    private fun processWsEvent(event: Map<String, Any?>) {
        when (event["type"] as? String) {
            "message" -> {
                val msg = (event["message"] as? Map<*, *>)?.let { rawToMessage(it) } ?: return
                appendMessage(msg)
                _uiState.update { state ->
                    state.copy(
                        conversations = state.conversations.map { conv ->
                            if (conv.id == msg.conversationId)
                                conv.copy(lastMessage = msg, updatedAt = msg.displayTime)
                            else conv
                        }
                    )
                }
            }
            "message_edited" -> {
                val msg = (event["message"] as? Map<*, *>)?.let { rawToMessage(it) } ?: return
                _uiState.update { state ->
                    val updated = state.messages[msg.conversationId]?.map { if (it.id == msg.id) msg else it }
                    state.copy(messages = state.messages + (msg.conversationId to (updated ?: listOf(msg))))
                }
            }
            "message_deleted" -> {
                val msgId = (event["message_id"] as? Double)?.toLong() ?: return
                val convId = (event["conversation_id"] as? Double)?.toLong() ?: return
                _uiState.update { state ->
                    val updated = state.messages[convId]?.filter { it.id != msgId }
                    state.copy(messages = if (updated != null) state.messages + (convId to updated) else state.messages)
                }
            }
            "messages_read" -> {
                val convId = (event["conversation_id"] as? Double)?.toLong() ?: return
                _uiState.update { state ->
                    state.copy(conversations = state.conversations.map { c ->
                        if (c.id == convId) c.copy(unreadCount = 0) else c
                    })
                }
            }
            "user_online" -> {
                val userId = (event["user_id"] as? Double)?.toLong() ?: return
                _uiState.update { state ->
                    state.copy(users = state.users.map { u -> if (u.id == userId) u.copy(isOnline = true) else u })
                }
            }
            "user_offline" -> {
                val userId = (event["user_id"] as? Double)?.toLong() ?: return
                _uiState.update { state ->
                    state.copy(users = state.users.map { u -> if (u.id == userId) u.copy(isOnline = false) else u })
                }
            }
        }
    }

    private fun appendMessage(msg: MessageDto) {
        _uiState.update { state ->
            val current = state.messages[msg.conversationId] ?: emptyList()
            if (current.any { it.id == msg.id }) return@update state
            state.copy(messages = state.messages + (msg.conversationId to current + msg))
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun rawToMessage(raw: Map<*, *>): MessageDto? = runCatching {
        val json = mapAdapter.toJson(raw as Map<String, Any?>)
        messageAdapter.fromJson(json)
    }.getOrNull()

    // ── Conversations ──────────────────────────────────────────────────────────

    fun loadConversations() {
        viewModelScope.launch {
            _uiState.update { it.copy(loading = true, error = null) }
            runCatching { chatRepository.getConversations() }
                .onSuccess { list -> _uiState.update { it.copy(loading = false, conversations = list) } }
                .onFailure { err -> _uiState.update { it.copy(loading = false, error = err.message ?: "Failed to load conversations") } }
        }
    }

    fun createConversation(participantIds: List<Long>, isGroup: Boolean, name: String?) {
        viewModelScope.launch {
            runCatching { chatRepository.createConversation(participantIds, isGroup, name) }
                .onSuccess { conv ->
                    _uiState.update { it.copy(conversations = it.conversations + conv) }
                    selectConversation(conv.id)
                }
                .onFailure { err -> _uiState.update { it.copy(error = err.message ?: "Failed to create conversation") } }
        }
    }

    // ── Active conversation ────────────────────────────────────────────────────

    fun selectConversation(id: Long) {
        _uiState.update { it.copy(activeConversationId = id, composingText = "", editingMessage = null) }
        if (!_uiState.value.messages.containsKey(id)) loadMessages(id)
        viewModelScope.launch {
            runCatching { chatRepository.markRead(id) }
            _uiState.update { state ->
                state.copy(conversations = state.conversations.map { c ->
                    if (c.id == id) c.copy(unreadCount = 0) else c
                })
            }
        }
    }

    fun loadMessages(conversationId: Long) {
        viewModelScope.launch {
            _uiState.update { it.copy(messagesLoading = true) }
            runCatching { chatRepository.getMessages(conversationId) }
                .onSuccess { msgs ->
                    _uiState.update { state ->
                        state.copy(messagesLoading = false, messages = state.messages + (conversationId to msgs))
                    }
                }
                .onFailure { err ->
                    _uiState.update { it.copy(messagesLoading = false, error = err.message ?: "Failed to load messages") }
                }
        }
    }

    // ── Compose / Send / Edit / Delete ─────────────────────────────────────────

    fun onComposeTextChange(text: String) = _uiState.update { it.copy(composingText = text) }

    fun sendMessage() {
        val state = _uiState.value
        val convId = state.activeConversationId ?: return
        val text = state.composingText.trim()
        if (text.isBlank()) return

        if (state.editingMessage != null) {
            submitEdit(state.editingMessage.id, text)
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isSending = true, composingText = "") }
            runCatching { chatRepository.sendMessage(convId, text) }
                .onSuccess { msg ->
                    if (msg != null) appendMessage(msg)   // REST fallback: add directly
                    _uiState.update { it.copy(isSending = false) }
                }
                .onFailure { err ->
                    _uiState.update { it.copy(isSending = false, composingText = text, error = err.message ?: "Send failed") }
                }
        }
    }

    fun startEditing(message: MessageDto) =
        _uiState.update { it.copy(editingMessage = message, composingText = message.content) }

    fun cancelEditing() =
        _uiState.update { it.copy(editingMessage = null, composingText = "") }

    private fun submitEdit(messageId: Long, content: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isSending = true, composingText = "", editingMessage = null) }
            runCatching { chatRepository.editMessage(messageId, content) }
                .onSuccess { updated ->
                    _uiState.update { state ->
                        val msgs = state.messages[updated.conversationId]?.map { if (it.id == updated.id) updated else it }
                        state.copy(
                            isSending = false,
                            messages = if (msgs != null) state.messages + (updated.conversationId to msgs) else state.messages
                        )
                    }
                }
                .onFailure { err -> _uiState.update { it.copy(isSending = false, error = err.message ?: "Edit failed") } }
        }
    }

    fun deleteMessage(messageId: Long, conversationId: Long) {
        viewModelScope.launch {
            runCatching { chatRepository.deleteMessage(messageId) }
                .onSuccess {
                    _uiState.update { state ->
                        val msgs = state.messages[conversationId]?.filter { it.id != messageId }
                        state.copy(messages = if (msgs != null) state.messages + (conversationId to msgs) else state.messages)
                    }
                }
                .onFailure { err -> _uiState.update { it.copy(error = err.message ?: "Delete failed") } }
        }
    }

    // ── Users ──────────────────────────────────────────────────────────────────

    fun loadUsers() {
        viewModelScope.launch {
            _uiState.update { it.copy(usersLoading = true) }
            runCatching { chatRepository.getUsers() }
                .onSuccess { list -> _uiState.update { it.copy(usersLoading = false, users = list) } }
                .onFailure { err -> _uiState.update { it.copy(usersLoading = false, error = err.message) } }
        }
    }

    fun clearError() = _uiState.update { it.copy(error = null) }
}