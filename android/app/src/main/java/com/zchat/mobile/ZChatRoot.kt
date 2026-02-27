package com.zchat.mobile

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.zchat.mobile.feature.auth.AuthViewModel
import com.zchat.mobile.feature.chat.ChatViewModel

@Composable
fun ZChatRoot(
    authViewModel: AuthViewModel = hiltViewModel(),
    chatViewModel: ChatViewModel = hiltViewModel()
) {
    val authState by authViewModel.uiState.collectAsStateWithLifecycle()
    val chatState by chatViewModel.uiState.collectAsStateWithLifecycle()

    if (authState.loading) {
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            CircularProgressIndicator()
        }
        return
    }

    if (!authState.authenticated) {
        LoginScreen(
            username = authState.username,
            password = authState.password,
            rememberMe = authState.rememberMe,
            error = authState.error,
            onUsernameChanged = authViewModel::onUsernameChange,
            onPasswordChanged = authViewModel::onPasswordChange,
            onRememberChanged = authViewModel::onRememberMeChange,
            onLoginClicked = authViewModel::login
        )
        return
    }

    LaunchedEffect(authState.token) {
        chatViewModel.connectRealtime(authState.token)
        chatViewModel.loadConversations()
    }

    ChatShell(
        wsConnected = chatState.wsConnected,
        loading = chatState.loading,
        error = chatState.error,
        conversations = chatState.conversations.map { it.name ?: "Conversation #${it.id}" },
        onRefresh = chatViewModel::loadConversations,
        onLogout = {
            chatViewModel.disconnectRealtime()
            authViewModel.logout()
        }
    )
}

@Composable
private fun LoginScreen(
    username: String,
    password: String,
    rememberMe: Boolean,
    error: String?,
    onUsernameChanged: (String) -> Unit,
    onPasswordChanged: (String) -> Unit,
    onRememberChanged: (Boolean) -> Unit,
    onLoginClicked: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.Center
    ) {
        Text("zChat Android", style = MaterialTheme.typography.headlineSmall)
        Spacer(modifier = Modifier.height(16.dp))
        TextField(value = username, onValueChange = onUsernameChanged, modifier = Modifier.fillMaxWidth(), label = { Text("Username") })
        Spacer(modifier = Modifier.height(8.dp))
        TextField(value = password, onValueChange = onPasswordChanged, modifier = Modifier.fillMaxWidth(), label = { Text("Password") })
        Spacer(modifier = Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = rememberMe, onCheckedChange = onRememberChanged)
            Text("Remember me")
        }
        if (!error.isNullOrBlank()) {
            Spacer(modifier = Modifier.height(8.dp))
            Text(error, color = MaterialTheme.colorScheme.error)
        }
        Spacer(modifier = Modifier.height(12.dp))
        Button(onClick = onLoginClicked, modifier = Modifier.fillMaxWidth()) {
            Text("Login")
        }
    }
}

@Composable
private fun ChatShell(
    wsConnected: Boolean,
    loading: Boolean,
    error: String?,
    conversations: List<String>,
    onRefresh: () -> Unit,
    onLogout: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        Text(if (wsConnected) "Realtime connected" else "Realtime disconnected")
        Spacer(modifier = Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = onRefresh) {
                Text("Refresh")
            }
            Button(onClick = onLogout) {
                Text("Logout")
            }
        }
        Spacer(modifier = Modifier.height(12.dp))
        if (loading) {
            CircularProgressIndicator()
        }
        if (!error.isNullOrBlank()) {
            Text(error, color = MaterialTheme.colorScheme.error)
        }
        LazyColumn(modifier = Modifier.fillMaxWidth()) {
            items(conversations) { item ->
                Text(item, modifier = Modifier.padding(vertical = 8.dp))
            }
        }
    }
}