package com.zchat.mobile.feature.chat

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.zchat.mobile.data.remote.dto.UserDto

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewConversationScreen(
    state: ChatUiState,
    currentUserId: Long?,
    onBack: () -> Unit,
    onLoadUsers: () -> Unit,
    onCreateConversation: (participantIds: List<Long>, isGroup: Boolean, name: String?) -> Unit,
) {
    LaunchedEffect(Unit) {
        if (state.users.isEmpty()) onLoadUsers()
    }

    val selectedIds = remember { mutableStateListOf<Long>() }
    val others = state.users.filter { it.id != currentUserId }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("New Conversation") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    if (selectedIds.isNotEmpty()) {
                        Button(
                            onClick = {
                                val isGroup = selectedIds.size > 1
                                onCreateConversation(selectedIds.toList(), isGroup, null)
                            },
                            modifier = Modifier.padding(end = 8.dp)
                        ) {
                            Text("Start (${selectedIds.size})")
                        }
                    }
                }
            )
        }
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) {
            when {
                state.usersLoading -> CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
                others.isEmpty() -> Text(
                    "No other users found.",
                    modifier = Modifier.align(Alignment.Center),
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                else -> LazyColumn {
                    items(others, key = { it.id }) { user ->
                        UserSelectItem(
                            user = user,
                            selected = user.id in selectedIds,
                            onToggle = {
                                if (user.id in selectedIds) selectedIds.remove(user.id)
                                else selectedIds.add(user.id)
                            }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun UserSelectItem(
    user: UserDto,
    selected: Boolean,
    onToggle: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onToggle)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Checkbox(checked = selected, onCheckedChange = { onToggle() })
        Spacer(Modifier.width(12.dp))
        Text(
            text = user.username,
            style = MaterialTheme.typography.bodyLarge
        )
        if (user.isOnline == true) {
            Spacer(Modifier.width(8.dp))
            Text(
                text = "● Online",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.tertiary
            )
        }
    }
}
