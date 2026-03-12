package com.zchat.mobile.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zchat.mobile.data.repository.ApiResult
import com.zchat.mobile.data.repository.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AuthUiState(
    val loading: Boolean = true,
    val authenticated: Boolean = false,
    val username: String = "",
    val email: String = "",
    val password: String = "",
    val rememberMe: Boolean = false,   // default false — opt-in, not opt-out
    val isRegisterMode: Boolean = false,
    val error: String? = null,
    val token: String? = null,
    val currentUserId: Long? = null
)

@HiltViewModel
class AuthViewModel @Inject constructor(
    private val authRepository: AuthRepository
) : ViewModel() {
    private val _uiState = MutableStateFlow(AuthUiState())
    val uiState: StateFlow<AuthUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            // Sequential: bootstrap validates stored token first, then collect ongoing changes
            val hasSession = authRepository.bootstrapSession()
            if (!hasSession) {
                _uiState.update { it.copy(loading = false, authenticated = false) }
            }
            authRepository.session.collect { session ->
                _uiState.update {
                    it.copy(
                        authenticated = !session.token.isNullOrBlank(),
                        loading = false,
                        token = session.token,
                        currentUserId = session.userId
                    )
                }
            }
        }
    }

    fun onUsernameChange(value: String) = _uiState.update { it.copy(username = value, error = null) }
    fun onEmailChange(value: String) = _uiState.update { it.copy(email = value, error = null) }
    fun onPasswordChange(value: String) = _uiState.update { it.copy(password = value, error = null) }
    fun onRememberMeChange(value: Boolean) = _uiState.update { it.copy(rememberMe = value) }
    fun switchToRegister() = _uiState.update { it.copy(isRegisterMode = true, error = null) }
    fun switchToLogin() = _uiState.update { it.copy(isRegisterMode = false, error = null) }

    fun login() {
        val s = _uiState.value
        if (s.username.isBlank() || s.password.isBlank()) {
            _uiState.update { it.copy(error = "Enter username and password") }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(loading = true, error = null) }
            when (val result = authRepository.login(s.username, s.password, s.rememberMe)) {
                is ApiResult.Success -> _uiState.update { it.copy(loading = false) }
                is ApiResult.Error -> _uiState.update { it.copy(loading = false, error = result.message) }
            }
        }
    }

    fun register() {
        val s = _uiState.value
        if (s.username.isBlank() || s.password.isBlank()) {
            _uiState.update { it.copy(error = "Username and password are required") }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(loading = true, error = null) }
            when (val result = authRepository.register(
                username = s.username,
                email = s.email.ifBlank { null },
                password = s.password,
                rememberMe = s.rememberMe
            )) {
                is ApiResult.Success -> _uiState.update { it.copy(loading = false) }
                is ApiResult.Error -> _uiState.update { it.copy(loading = false, error = result.message) }
            }
        }
    }

    fun logout() {
        viewModelScope.launch { authRepository.logout() }
    }
}