package com.zchat.mobile.data.remote.network

import android.util.Log
import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import com.zchat.mobile.BuildConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ZChatWebSocketClient @Inject constructor(
    private val okHttpClient: OkHttpClient,
    private val moshi: Moshi
) {
    private val scope = CoroutineScope(Dispatchers.IO)
    private val adapter = moshi.adapter<Map<String, Any?>>(Types.newParameterizedType(Map::class.java, String::class.java, Any::class.java))

    private var webSocket: WebSocket? = null

    private val _connected = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = _connected.asStateFlow()

    private val _events = MutableStateFlow<Map<String, Any?>?>(null)
    val events: StateFlow<Map<String, Any?>?> = _events.asStateFlow()

    fun connect(token: String) {
        disconnect()
        val request = Request.Builder()
            .url(BuildConfig.WS_BASE_URL)
            .addHeader("Sec-WebSocket-Protocol", "bearer, $token")
            .addHeader("Origin", BuildConfig.WS_ORIGIN)
            .build()
        webSocket = okHttpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                _connected.value = true
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                runCatching {
                    adapter.fromJson(text)
                }.onSuccess { payload ->
                    if (payload != null) {
                        _events.value = payload
                    }
                }.onFailure {
                    Log.e("ZChatWS", "Failed to decode event", it)
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                _connected.value = false
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e("ZChatWS", "WebSocket failure", t)
                _connected.value = false
            }
        })
    }

    fun send(payload: Map<String, Any?>) {
        val text = adapter.toJson(payload)
        webSocket?.send(text)
    }

    fun disconnect() {
        webSocket?.close(1000, "disconnect")
        webSocket = null
        _connected.value = false
    }
}