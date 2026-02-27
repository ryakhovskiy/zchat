package com.zchat.mobile.feature.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zchat.mobile.data.remote.dto.ConversationDto
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
    val wsConnected: Boolean = false,
    val error: String? = null
)

@HiltViewModel
class ChatViewModel @Inject constructor(
    private val chatRepository: ChatRepository
) : ViewModel() {
    private val _uiState = MutableStateFlow(ChatUiState())
    val uiState: StateFlow<ChatUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            chatRepository.wsConnected.collect { connected ->
                _uiState.update { it.copy(wsConnected = connected) }
            }
        }
    }

    fun connectRealtime(token: String?) {
        if (token.isNullOrBlank()) return
        chatRepository.connectRealtime(token)
    }

    fun disconnectRealtime() {
        chatRepository.disconnectRealtime()
    }

    fun loadConversations() {
        viewModelScope.launch {
            _uiState.update { it.copy(loading = true, error = null) }
            runCatching {
                chatRepository.getConversations()
            }.onSuccess { conversations ->
                _uiState.update { it.copy(loading = false, conversations = conversations) }
            }.onFailure { err ->
                _uiState.update { it.copy(loading = false, error = err.message ?: "Failed to load chats") }
            }
        }
    }
}