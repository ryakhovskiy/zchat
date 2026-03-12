package com.zchat.mobile.feature.chat

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
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
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ConversationListState(
    val loading: Boolean = false,
    val conversations: List<ConversationDto> = emptyList(),
    val wsConnected: Boolean = false,
    val error: String? = null
)

data class ActiveConversationState(
    val conversationId: Long? = null,
    val messages: Map<Long, List<MessageDto>> = emptyMap(),
    val typingUsers: List<String> = emptyList(),
    val loading: Boolean = false,
    val composingText: String = "",
    val editingMessage: MessageDto? = null,
    val isSending: Boolean = false,
    val isUploading: Boolean = false,
    val error: String? = null
)

data class NewConversationState(
    val users: List<UserDto> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null
)

@HiltViewModel
class ChatViewModel @Inject constructor(
    private val chatRepository: ChatRepository,
    private val moshi: Moshi
) : ViewModel() {

    private val _listState = MutableStateFlow(ConversationListState())
    val listState: StateFlow<ConversationListState> = _listState.asStateFlow()

    private val _activeState = MutableStateFlow(ActiveConversationState())
    val activeState: StateFlow<ActiveConversationState> = _activeState.asStateFlow()

    private val _newState = MutableStateFlow(NewConversationState())
    val newState: StateFlow<NewConversationState> = _newState.asStateFlow()

    private val messageAdapter = moshi.adapter(MessageDto::class.java)
    private val mapAdapter = moshi.adapter<Map<String, Any?>>(
        Types.newParameterizedType(Map::class.java, String::class.java, Any::class.java)
    )

    private val typingJobs = mutableMapOf<Long, Job>()
    private var lastTypingTime = 0L

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

    private fun processWsEvent(event: Map<String, Any?>) {
        when (event["type"] as? String) {
            "message" -> {
                val msg = (event["message"] as? Map<*, *>)?.let { rawToMessage(it) } ?: return
                appendMessage(msg)
                _listState.update { state ->
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
                _activeState.update { state ->
                    val updated = state.messages[msg.conversationId]?.map { if (it.id == msg.id) msg else it }
                    state.copy(messages = state.messages + (msg.conversationId to (updated ?: listOf(msg))))
                }
            }
            "message_deleted" -> {
                val msgId = (event["message_id"] as? Double)?.toLong() ?: return
                val convId = (event["conversation_id"] as? Double)?.toLong() ?: return
                _activeState.update { state ->
                    val updated = state.messages[convId]?.filter { it.id != msgId }
                    state.copy(messages = if (updated != null) state.messages + (convId to updated) else state.messages)
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
            "typing" -> {
                val convId = (event["conversation_id"] as? Double)?.toLong() ?: return
                val userId = (event["user_id"] as? Double)?.toLong() ?: return
                val username = event["username"] as? String ?: return

                if (_activeState.value.conversationId == convId) {
                    _activeState.update { state ->
                        if (!state.typingUsers.contains(username)) {
                            state.copy(typingUsers = state.typingUsers + username)
                        } else state
                    }
                    
                    typingJobs[userId]?.cancel()
                    typingJobs[userId] = viewModelScope.launch {
                        delay(3000)
                        _activeState.update { state ->
                            state.copy(typingUsers = state.typingUsers - username)
                        }
                        typingJobs.remove(userId)
                    }
                }
            }
        }
    }

    private fun appendMessage(msg: MessageDto) {
        _activeState.update { state ->
            // If the incoming message doesn't belong to the active conversation,
            // we don't need to append it mapped in `messages` to save memory.
            // The ConversationListScreen will still reflect the new "lastMessage"
            // through the event processor.
            if (msg.conversationId != state.conversationId) return@update state

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
            _listState.update { it.copy(loading = true, error = null) }
            runCatching { chatRepository.getConversations() }
                .onSuccess { list -> _listState.update { it.copy(loading = false, conversations = list) } }
                .onFailure { err -> _listState.update { it.copy(loading = false, error = err.message ?: "Failed to load conversations") } }
        }
    }

    fun createConversation(participantIds: List<Long>, isGroup: Boolean, name: String?) {
        viewModelScope.launch {
            runCatching { chatRepository.createConversation(participantIds, isGroup, name) }
                .onSuccess { conv ->
                    _listState.update { it.copy(conversations = it.conversations + conv) }
                    selectConversation(conv.id)
                }
                .onFailure { err -> _listState.update { it.copy(error = err.message ?: "Failed to create conversation") } }
        }
    }

    // ── Active conversation ────────────────────────────────────────────────────

    fun selectConversation(id: Long) {
        _activeState.update { it.copy(conversationId = id, composingText = "", editingMessage = null) }
        
        // Evict unneeded conversations from memory (keep only the active one and any recent caches if needed, but here we just clear others to be strict)
        _activeState.update { state ->
            val keptMessages = state.messages.filterKeys { it == id }
            state.copy(messages = keptMessages)
        }

        if (!_activeState.value.messages.containsKey(id)) loadMessages(id)
        viewModelScope.launch {
            runCatching { chatRepository.markRead(id) }
            _listState.update { state ->
                state.copy(conversations = state.conversations.map { c ->
                    if (c.id == id) c.copy(unreadCount = 0) else c
                })
            }
        }
    }

    fun loadMessages(conversationId: Long) {
        viewModelScope.launch {
            _activeState.update { it.copy(loading = true) }
            runCatching { chatRepository.getMessages(conversationId) }
                .onSuccess { msgs ->
                    _activeState.update { state ->
                        state.copy(loading = false, messages = state.messages + (conversationId to msgs))
                    }
                }
                .onFailure { err ->
                    _activeState.update { it.copy(loading = false, error = err.message ?: "Failed to load messages") }
                }
        }
    }

    // ── Compose / Send / Edit / Delete ─────────────────────────────────────────

    fun onComposeTextChange(text: String) {
        _activeState.update { it.copy(composingText = text) }
        val convId = _activeState.value.conversationId
        if (convId != null && text.isNotEmpty()) {
            val now = System.currentTimeMillis()
            if (now - lastTypingTime > 2000) {
                lastTypingTime = now
                chatRepository.sendTyping(convId)
            }
        }
    }

    fun uploadFile(uri: Uri, context: Context) {
        val state = _activeState.value
        val convId = state.conversationId ?: return

        viewModelScope.launch {
            _activeState.update { it.copy(isUploading = true) }
            runCatching {
                val contentResolver = context.contentResolver
                val mimeType = contentResolver.getType(uri) ?: "application/octet-stream"
                val inputStream = contentResolver.openInputStream(uri) ?: throw Exception("Cannot open file")
                
                var fileName = "upload"
                contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        if (nameIndex != -1) fileName = cursor.getString(nameIndex)
                    }
                }

                val bytes = inputStream.readBytes()
                val requestBody = bytes.toRequestBody(mimeType.toMediaTypeOrNull())
                val part = MultipartBody.Part.createFormData("file", fileName, requestBody)

                chatRepository.uploadFile(part)
            }
            .onSuccess { res ->
                _activeState.update { it.copy(isUploading = false) }
                // Auto-send a message with the uploaded file
                runCatching { chatRepository.sendMessageWithFile(convId, "", res.filePath, res.fileType) }
            }
            .onFailure { err ->
                _activeState.update { it.copy(isUploading = false, error = err.message ?: "Upload failed") }
            }
        }
    }

    fun sendMessage() {
        val state = _activeState.value
        val convId = state.conversationId ?: return
        val text = state.composingText.trim()
        if (text.isBlank()) return

        if (state.editingMessage != null) {
            submitEdit(state.editingMessage.id, text)
            return
        }

        viewModelScope.launch {
            _activeState.update { it.copy(isSending = true, composingText = "") }
            runCatching { chatRepository.sendMessage(convId, text) }
                .onSuccess { msg ->
                    if (msg != null) appendMessage(msg)   // REST fallback: add directly
                    _activeState.update { it.copy(isSending = false) }
                }
                .onFailure { err ->
                    _activeState.update { it.copy(isSending = false, composingText = text, error = err.message ?: "Send failed") }
                }
        }
    }

    fun startEditing(message: MessageDto) =
        _activeState.update { it.copy(editingMessage = message, composingText = message.content) }

    fun cancelEditing() =
        _activeState.update { it.copy(editingMessage = null, composingText = "") }

    private fun submitEdit(messageId: Long, content: String) {
        viewModelScope.launch {
            _activeState.update { it.copy(isSending = true, composingText = "", editingMessage = null) }
            runCatching { chatRepository.editMessage(messageId, content) }
                .onSuccess { updated ->
                    _activeState.update { state ->
                        val msgs = state.messages[updated.conversationId]?.map { if (it.id == updated.id) updated else it }
                        state.copy(
                            isSending = false,
                            messages = if (msgs != null) state.messages + (updated.conversationId to msgs) else state.messages
                        )
                    }
                }
                .onFailure { err -> _activeState.update { it.copy(isSending = false, error = err.message ?: "Edit failed") } }
        }
    }

    fun deleteMessage(messageId: Long, conversationId: Long) {
        viewModelScope.launch {
            runCatching { chatRepository.deleteMessage(messageId) }
                .onSuccess {
                    _activeState.update { state ->
                        val msgs = state.messages[conversationId]?.filter { it.id != messageId }
                        state.copy(messages = if (msgs != null) state.messages + (conversationId to msgs) else state.messages)
                    }
                }
                .onFailure { err -> _activeState.update { it.copy(error = err.message ?: "Delete failed") } }
        }
    }

    // ── Users ──────────────────────────────────────────────────────────────────

    fun loadUsers() {
        viewModelScope.launch {
            _newState.update { it.copy(loading = true) }
            runCatching { chatRepository.getUsers() }
                .onSuccess { list -> _newState.update { it.copy(loading = false, users = list) } }
                .onFailure { err -> _newState.update { it.copy(loading = false, error = err.message) } }
        }
    }

    fun clearError() {
        _listState.update { it.copy(error = null) }
        _activeState.update { it.copy(error = null) }
        _newState.update { it.copy(error = null) }
    }
}