package com.zchat.mobile.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.zchat.mobile.data.local.AuthTokenStore
import com.zchat.mobile.data.local.ServerConfigManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SettingsUiState(
    val apiBaseUrl: String = "",
    val wsBaseUrl: String = "",
    val wsOrigin: String = "",
    val saved: Boolean = false
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val serverConfig: ServerConfigManager,
    private val tokenStore: AuthTokenStore
) : ViewModel() {

    private val _state = MutableStateFlow(
        SettingsUiState(
            apiBaseUrl = serverConfig.apiBaseUrl,
            wsBaseUrl = serverConfig.wsBaseUrl,
            wsOrigin = serverConfig.wsOrigin
        )
    )
    val state: StateFlow<SettingsUiState> = _state.asStateFlow()

    val isLoggedIn: Boolean get() = !tokenStore.memCache.token.isNullOrBlank()

    fun onApiBaseUrlChanged(value: String) {
        _state.update { it.copy(apiBaseUrl = value, saved = false) }
    }

    fun onWsBaseUrlChanged(value: String) {
        _state.update { it.copy(wsBaseUrl = value, saved = false) }
    }

    fun onWsOriginChanged(value: String) {
        _state.update { it.copy(wsOrigin = value, saved = false) }
    }

    fun save() {
        viewModelScope.launch {
            val s = _state.value
            serverConfig.save(s.apiBaseUrl, s.wsBaseUrl, s.wsOrigin)
            _state.update { it.copy(saved = true) }
            if (!tokenStore.memCache.token.isNullOrBlank()) {
                tokenStore.clearMemCache()
                tokenStore.clear()
            }
        }
    }

    fun resetToDefaults() {
        viewModelScope.launch {
            serverConfig.resetToDefaults()
            _state.update {
                SettingsUiState(
                    apiBaseUrl = serverConfig.apiBaseUrl,
                    wsBaseUrl = serverConfig.wsBaseUrl,
                    wsOrigin = serverConfig.wsOrigin
                )
            }
        }
    }
}
