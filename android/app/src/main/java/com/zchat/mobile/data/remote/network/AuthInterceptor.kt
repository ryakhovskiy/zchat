package com.zchat.mobile.data.remote.network

import com.zchat.mobile.data.local.AuthTokenStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthInterceptor @Inject constructor(
    private val tokenStore: AuthTokenStore
) : Interceptor {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun intercept(chain: Interceptor.Chain): Response {
        val token = tokenStore.memCache.token
        val reqBuilder = chain.request().newBuilder()
        if (!token.isNullOrBlank()) {
            reqBuilder.addHeader("Authorization", "Bearer $token")
        }
        val response = chain.proceed(reqBuilder.build())

        // On 401: clear in-memory cache synchronously, persist asynchronously
        if (response.code == 401 && !token.isNullOrBlank()) {
            tokenStore.clearMemCache()
            scope.launch { tokenStore.clear() }
        }

        return response
    }
}