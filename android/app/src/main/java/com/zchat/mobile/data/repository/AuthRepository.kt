package com.zchat.mobile.data.repository

import com.zchat.mobile.data.local.AuthSession
import com.zchat.mobile.data.local.AuthTokenStore
import com.zchat.mobile.data.remote.api.AuthApi
import com.zchat.mobile.data.remote.dto.LoginRequestDto
import com.zchat.mobile.data.remote.dto.RegisterRequestDto
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthRepository @Inject constructor(
    private val authApi: AuthApi,
    private val tokenStore: AuthTokenStore
) {
    val session: Flow<AuthSession> = tokenStore.session

    suspend fun login(username: String, password: String, rememberMe: Boolean) {
        val response = authApi.login(LoginRequestDto(username, password, rememberMe))
        tokenStore.saveSession(response.accessToken, response.user.username, response.user.id, rememberMe)
    }

    suspend fun register(username: String, email: String?, password: String, rememberMe: Boolean) {
        val response = authApi.register(RegisterRequestDto(username = username, email = email, password = password))
        tokenStore.saveSession(response.accessToken, response.user.username, response.user.id, rememberMe)
    }

    suspend fun bootstrapSession(): Boolean {
        return runCatching {
            authApi.me()
            true
        }.getOrElse {
            tokenStore.clear()
            false
        }
    }

    suspend fun logout() {
        runCatching { authApi.logout() }
        tokenStore.clear()
    }
}