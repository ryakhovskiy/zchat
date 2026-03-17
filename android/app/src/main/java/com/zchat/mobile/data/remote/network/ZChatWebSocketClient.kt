package com.zchat.mobile.data.remote.network

import android.util.Log
import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import com.zchat.mobile.data.local.ServerConfigManager
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.Job
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
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
    private val moshi: Moshi,
    private val serverConfig: ServerConfigManager
) {
    private val adapter = moshi.adapter<Map<String, Any?>>(
        Types.newParameterizedType(Map::class.java, String::class.java, Any::class.java)
    )

    private var webSocket: WebSocket? = null

    private val _connected = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = _connected.asStateFlow()

    private val _connectionFailed = MutableStateFlow(false)
    val connectionFailed: StateFlow<Boolean> = _connectionFailed.asStateFlow()

    private var reconnectAttempt = 0
    private var reconnectJob: Job? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var currentToken: String? = null

    // SharedFlow so that identical consecutive events (same message content) are both delivered
    private val _events = MutableSharedFlow<Map<String, Any?>>(extraBufferCapacity = 64)
    val events: SharedFlow<Map<String, Any?>> = _events.asSharedFlow()

    fun connect(token: String) {
        currentToken = token
        reconnectAttempt = 0
        _connectionFailed.value = false
        connectInternal()
    }

    private fun connectInternal() {
        if (currentToken.isNullOrBlank()) return
        disconnectInternal()
        val request = Request.Builder()
            .url(serverConfig.wsBaseUrl)
            .addHeader("Sec-WebSocket-Protocol", "bearer, $currentToken")
            .addHeader("Origin", serverConfig.wsOrigin)
            .build()
        webSocket = okHttpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                _connected.value = true
                reconnectAttempt = 0
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                runCatching {
                    adapter.fromJson(text)
                }.onSuccess { payload ->
                    if (payload != null) {
                        _events.tryEmit(payload)
                    }
                }.onFailure {
                    Log.e("ZChatWS", "Failed to decode event", it)
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                _connected.value = false
                if (currentToken != null && code != 1000) {
                    scheduleReconnect()
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e("ZChatWS", "WebSocket failure", t)
                _connected.value = false
                scheduleReconnect()
            }
        })
    }

    private fun scheduleReconnect() {
        if (reconnectAttempt >= 5) {
            Log.w("ZChatWS", "Max reconnect attempts reached")
            _connectionFailed.value = true
            return
        }
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            val delayMs = 1000L * (1 shl reconnectAttempt)
            delay(delayMs)
            reconnectAttempt++
            connectInternal()
        }
    }

    fun send(payload: Map<String, Any?>) {
        val text = adapter.toJson(payload)
        webSocket?.send(text)
    }

    private fun disconnectInternal() {
        webSocket?.close(1000, "disconnect")
        webSocket = null
        _connected.value = false
    }

    fun disconnect() {
        reconnectJob?.cancel()
        currentToken = null
        reconnectAttempt = 0
        _connectionFailed.value = false
        disconnectInternal()
    }
}