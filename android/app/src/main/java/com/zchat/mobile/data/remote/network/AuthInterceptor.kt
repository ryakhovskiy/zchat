package com.zchat.mobile.data.remote.network

import com.zchat.mobile.data.local.AuthTokenStore
import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthInterceptor @Inject constructor(
    private val tokenStore: AuthTokenStore
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        // Use synchronous in-memory cache — avoids runBlocking on OkHttp dispatcher
        val token = tokenStore.memCache.token
        val reqBuilder = chain.request().newBuilder()
        if (!token.isNullOrBlank()) {
            reqBuilder.addHeader("Authorization", "Bearer $token")
        }
        val response = chain.proceed(reqBuilder.build())

        // Clear session on 401 — triggers navigation to login via AuthUiState flow
        if (response.code == 401 && !token.isNullOrBlank()) {
            runBlocking { tokenStore.clear() }
        }

        return response
    }
}