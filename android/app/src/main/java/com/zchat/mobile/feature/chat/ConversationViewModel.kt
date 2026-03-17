package com.zchat.mobile.feature.chat

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okio.source
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zchat.mobile.data.local.ServerConfigManager
import com.zchat.mobile.data.remote.dto.MessageDto
import com.zchat.mobile.data.repository.ApiResult
import com.zchat.mobile.data.repository.ChatRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject

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

@HiltViewModel
class ConversationViewModel @Inject constructor(
    private val chatRepository: ChatRepository,
    val serverConfig: ServerConfigManager
) : ViewModel() {

    private val _state = MutableStateFlow(ActiveConversationState())
    val state: StateFlow<ActiveConversationState> = _state.asStateFlow()

    private val typingJobs = mutableMapOf<Long, Job>()
    private var lastTypingTime = 0L

    init {
        viewModelScope.launch {
            chatRepository.wsEvents.collect { event -> processWsEvent(event) }
        }
    }

    // ── WS event handling (conversation-relevant events) ───────────────────────

    private fun processWsEvent(event: Map<String, Any?>) {
        when (event["type"] as? String) {
            "message" -> {
                val msg = wsEventToMessage(event) ?: return
                appendMessage(msg)
            }
            "message_edited" -> {
                val msgId = (event["message_id"] as? Number)?.toLong() ?: return
                val convId = (event["conversation_id"] as? Number)?.toLong() ?: return
                val content = event["content"] as? String ?: return
                _state.update { state ->
                    val updated = state.messages[convId]?.map {
                        if (it.id == msgId) it.copy(content = content, isEdited = true) else it
                    }
                    state.copy(messages = if (updated != null) state.messages + (convId to updated) else state.messages)
                }
            }
            "message_deleted" -> {
                val msgId = (event["message_id"] as? Number)?.toLong() ?: return
                val convId = (event["conversation_id"] as? Number)?.toLong() ?: return
                _state.update { state ->
                    val updated = state.messages[convId]?.filter { it.id != msgId }
                    state.copy(messages = if (updated != null) state.messages + (convId to updated) else state.messages)
                }
            }
            "typing" -> {
                val convId = (event["conversation_id"] as? Number)?.toLong() ?: return
                val userId = (event["user_id"] as? Number)?.toLong() ?: return
                val username = event["username"] as? String ?: return

                if (_state.value.conversationId == convId) {
                    _state.update { state ->
                        if (!state.typingUsers.contains(username)) {
                            state.copy(typingUsers = state.typingUsers + username)
                        } else state
                    }

                    typingJobs[userId]?.cancel()
                    typingJobs[userId] = viewModelScope.launch {
                        delay(3000)
                        _state.update { state ->
                            state.copy(typingUsers = state.typingUsers - username)
                        }
                        typingJobs.remove(userId)
                    }
                }
            }
        }
    }

    private fun appendMessage(msg: MessageDto) {
        _state.update { state ->
            if (msg.conversationId != state.conversationId) return@update state
            val current = state.messages[msg.conversationId] ?: emptyList()
            if (current.any { it.id == msg.id }) return@update state
            state.copy(messages = state.messages + (msg.conversationId to current + msg))
        }
    }

    private fun wsEventToMessage(event: Map<String, Any?>): MessageDto? {
        val id = (event["message_id"] as? Number)?.toLong() ?: return null
        val convId = (event["conversation_id"] as? Number)?.toLong() ?: return null
        return MessageDto(
            id = id,
            conversationId = convId,
            content = event["content"] as? String ?: "",
            senderId = (event["sender_id"] as? Number)?.toLong() ?: 0L,
            senderUsername = event["sender_username"] as? String,
            filePath = event["file_path"] as? String,
            fileType = event["file_type"] as? String,
            createdAt = event["timestamp"] as? String,
            isRead = event["is_read"] as? Boolean,
            isEdited = event["is_edited"] as? Boolean,
            isDeleted = event["is_deleted"] as? Boolean,
        )
    }

    // ── Active conversation ────────────────────────────────────────────────────

    fun selectConversation(id: Long) {
        _state.update { it.copy(conversationId = id, composingText = "", editingMessage = null) }

        _state.update { state ->
            val keptMessages = state.messages.filterKeys { it == id }
            state.copy(messages = keptMessages)
        }

        if (!_state.value.messages.containsKey(id)) loadMessages(id)
        viewModelScope.launch {
            chatRepository.markRead(id)
        }
    }

    fun loadMessages(conversationId: Long) {
        viewModelScope.launch {
            _state.update { it.copy(loading = true) }
            when (val result = chatRepository.getMessages(conversationId)) {
                is ApiResult.Success -> {
                    _state.update { state ->
                        state.copy(loading = false, messages = state.messages + (conversationId to result.data))
                    }
                }
                is ApiResult.Error -> {
                    _state.update { it.copy(loading = false, error = result.message) }
                }
            }
        }
    }

    // ── Compose / Send / Edit / Delete ─────────────────────────────────────────

    fun onComposeTextChange(text: String) {
        _state.update { it.copy(composingText = text) }
        val convId = _state.value.conversationId
        if (convId != null && text.isNotEmpty()) {
            val now = System.currentTimeMillis()
            if (now - lastTypingTime > 2000) {
                lastTypingTime = now
                chatRepository.sendTyping(convId)
            }
        }
    }

    fun uploadFile(uri: Uri, context: Context) {
        val convId = _state.value.conversationId ?: return

        viewModelScope.launch {
            _state.update { it.copy(isUploading = true) }
            try {
                val part = withContext(Dispatchers.IO) {
                    val contentResolver = context.contentResolver
                    val mimeType = contentResolver.getType(uri) ?: "application/octet-stream"

                    var fileName = "upload"
                    contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                        if (cursor.moveToFirst()) {
                            val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                            if (nameIndex != -1) fileName = cursor.getString(nameIndex)
                        }
                    }

                    val mediaType = mimeType.toMediaTypeOrNull()
                    val requestBody = object : okhttp3.RequestBody() {
                        override fun contentType() = mediaType
                        override fun writeTo(sink: okio.BufferedSink) {
                            contentResolver.openInputStream(uri)?.use { input ->
                                sink.writeAll(input.source())
                            } ?: throw Exception("Cannot open file")
                        }
                    }
                    MultipartBody.Part.createFormData("file", fileName, requestBody)
                }

                when (val result = chatRepository.uploadFile(part)) {
                    is ApiResult.Success -> {
                        _state.update { it.copy(isUploading = false) }
                        chatRepository.sendMessageWithFile(convId, "", result.data.filePath, result.data.fileType)
                    }
                    is ApiResult.Error -> {
                        _state.update { it.copy(isUploading = false, error = result.message) }
                    }
                }
            } catch (e: Exception) {
                _state.update { it.copy(isUploading = false, error = e.message ?: "Upload failed") }
            }
        }
    }

    fun sendMessage() {
        val currentState = _state.value
        val convId = currentState.conversationId ?: return
        val text = currentState.composingText.trim()
        if (text.isBlank()) return

        if (currentState.editingMessage != null) {
            submitEdit(currentState.editingMessage.id, text)
            return
        }

        viewModelScope.launch {
            _state.update { it.copy(isSending = true, composingText = "") }
            when (val result = chatRepository.sendMessage(convId, text)) {
                is ApiResult.Success -> {
                    if (result.data != null) appendMessage(result.data)
                    _state.update { it.copy(isSending = false) }
                }
                is ApiResult.Error -> {
                    _state.update { it.copy(isSending = false, composingText = text, error = result.message) }
                }
            }
        }
    }

    fun startEditing(message: MessageDto) =
        _state.update { it.copy(editingMessage = message, composingText = message.content) }

    fun cancelEditing() =
        _state.update { it.copy(editingMessage = null, composingText = "") }

    private fun submitEdit(messageId: Long, content: String) {
        viewModelScope.launch {
            _state.update { it.copy(isSending = true, composingText = "", editingMessage = null) }
            when (val result = chatRepository.editMessage(messageId, content)) {
                is ApiResult.Success -> {
                    val updated = result.data
                    _state.update { state ->
                        val msgs = state.messages[updated.conversationId]?.map { if (it.id == updated.id) updated else it }
                        state.copy(
                            isSending = false,
                            messages = if (msgs != null) state.messages + (updated.conversationId to msgs) else state.messages
                        )
                    }
                }
                is ApiResult.Error -> _state.update { it.copy(isSending = false, error = result.message) }
            }
        }
    }

    fun deleteMessage(messageId: Long, conversationId: Long) {
        viewModelScope.launch {
            when (val result = chatRepository.deleteMessage(messageId)) {
                is ApiResult.Success -> {
                    _state.update { state ->
                        val msgs = state.messages[conversationId]?.filter { it.id != messageId }
                        state.copy(messages = if (msgs != null) state.messages + (conversationId to msgs) else state.messages)
                    }
                }
                is ApiResult.Error -> _state.update { it.copy(error = result.message) }
            }
        }
    }

    fun clearError() {
        _state.update { it.copy(error = null) }
    }
}
