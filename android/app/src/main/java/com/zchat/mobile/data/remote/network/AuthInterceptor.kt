package com.zchat.mobile.data.remote.network

import com.zchat.mobile.data.local.AuthTokenStore
import com.zchat.mobile.data.local.ServerConfigManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthInterceptor @Inject constructor(
    private val tokenStore: AuthTokenStore,
    private val serverConfig: ServerConfigManager
) : Interceptor {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun intercept(chain: Interceptor.Chain): Response {
        var request = chain.request()

        // Rewrite base URL if the user changed the server endpoint at runtime
        val runtimeBase = serverConfig.apiBaseUrl.toHttpUrlOrNull()
        if (runtimeBase != null) {
            val newUrl = request.url.newBuilder()
                .scheme(runtimeBase.scheme)
                .host(runtimeBase.host)
                .port(runtimeBase.port)
                .build()
            request = request.newBuilder().url(newUrl).build()
        }

        val token = tokenStore.memCache.token
        val reqBuilder = request.newBuilder()
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