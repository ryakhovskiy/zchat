package com.zchat.mobile.feature.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.zchat.mobile.R
import com.zchat.mobile.data.remote.dto.ConversationDto
import com.zchat.mobile.ui.theme.ThemeMode
import com.zchat.mobile.ui.theme.ZChatTheme

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConversationListScreen(
    state: ConversationListState,
    currentUserId: Long?,
    themeMode: ThemeMode,
    incomingCall: IncomingCallEvent? = null,
    onToggleThemeMode: (ThemeMode) -> Unit,
    onConversationClicked: (Long) -> Unit,
    onNewConversationClicked: () -> Unit,
    onRefresh: () -> Unit,
    onLogout: () -> Unit,
    onSettingsClicked: () -> Unit = {},
    onRejectCall: () -> Unit = {},
    onDismissCall: () -> Unit = {},
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.title_messages)) },
                actions = {
                    if (state.wsConnected) {
                        Box(
                            modifier = Modifier
                                .padding(end = 4.dp)
                                .size(8.dp)
                                .clip(CircleShape)
                                .background(MaterialTheme.colorScheme.tertiary)
                        )
                    }
                    // Theme Toggle
                    IconButton(onClick = {
                        val nextMode = when (themeMode) {
                            ThemeMode.HACKER -> ThemeMode.DARK
                            ThemeMode.DARK -> ThemeMode.LIGHT
                            ThemeMode.LIGHT -> ThemeMode.HACKER
                        }
                        onToggleThemeMode(nextMode)
                    }) {
                        Text(
                            when (themeMode) {
                                ThemeMode.HACKER -> "💻"
                                ThemeMode.DARK -> "🌙"
                                ThemeMode.LIGHT -> "☀️"
                            }
                        )
                    }
                    IconButton(onClick = onSettingsClicked) {
                        Icon(Icons.Default.Settings, contentDescription = "Settings")
                    }
                    IconButton(onClick = onLogout) {
                        Icon(Icons.Default.Close, contentDescription = stringResource(R.string.action_logout))
                    }
                }
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = onNewConversationClicked) {
                Icon(Icons.Default.Add, contentDescription = stringResource(R.string.title_new_conversation))
            }
        }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) {
            // Incoming call banner
            AnimatedVisibility(visible = incomingCall != null) {
                incomingCall?.let { call ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(
                                MaterialTheme.colorScheme.tertiaryContainer,
                                RoundedCornerShape(bottomStart = 12.dp, bottomEnd = 12.dp)
                            )
                            .padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                "Incoming call",
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onTertiaryContainer
                            )
                            Text(
                                call.senderUsername,
                                style = MaterialTheme.typography.titleSmall,
                                color = MaterialTheme.colorScheme.onTertiaryContainer
                            )
                        }
                        OutlinedButton(onClick = onRejectCall) {
                            Text("Reject")
                        }
                        Spacer(Modifier.width(8.dp))
                        Button(
                            onClick = onDismissCall,
                        ) {
                            Text("Accept")
                        }
                    }
                }
            }

            PullToRefreshBox(
                isRefreshing = state.loading,
                onRefresh = onRefresh,
                modifier = Modifier.fillMaxSize()
            ) {
            when {
                state.conversations.isEmpty() && !state.loading -> {
                    Text(
                        stringResource(R.string.msg_no_conversations),
                        modifier = Modifier.align(Alignment.Center).padding(24.dp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                else -> {
                    LazyColumn(modifier = Modifier.fillMaxSize()) {
                        items(
                            items = state.conversations.sortedByDescending { it.updatedAt },
                            key = { it.id }
                        ) { conversation ->
                            ConversationItem(
                                conversation = conversation,
                                currentUserId = currentUserId,
                                onClick = { onConversationClicked(conversation.id) }
                            )
                            HorizontalDivider()
                        }
                    }
                }
            }

            if (!state.error.isNullOrBlank()) {
                Text(
                    state.error,
                    modifier = Modifier.align(Alignment.BottomCenter).padding(16.dp),
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall
                )
            }
            }
        }
    }
}

@Composable
private fun ConversationItem(
    conversation: ConversationDto,
    currentUserId: Long?,
    onClick: () -> Unit,
) {
    val displayName = conversation.name
        ?: conversation.participants
            ?.filter { it.id != currentUserId }
            ?.joinToString(", ") { it.username }
        ?: "Conversation #${conversation.id}"

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Avatar circle with initials
        Box(
            modifier = Modifier
                .size(44.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.primaryContainer),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = displayName.take(1).uppercase(),
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onPrimaryContainer
            )
        }

        Spacer(Modifier.width(12.dp))

        Column(modifier = Modifier.weight(1f)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = displayName,
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
                val unread = conversation.unreadCount ?: 0
                if (unread > 0) {
                    Spacer(Modifier.width(8.dp))
                    Box(
                        modifier = Modifier
                            .clip(CircleShape)
                            .background(MaterialTheme.colorScheme.primary)
                            .padding(horizontal = 6.dp, vertical = 2.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = if (unread > 99) "99+" else unread.toString(),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onPrimary
                        )
                    }
                }
            }

            val preview = conversation.lastMessage?.content ?: ""
            if (preview.isNotBlank()) {
                Text(
                    text = preview,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun ConversationListScreenPreview() {
    ZChatTheme {
        ConversationListScreen(
            state = ConversationListState(
                conversations = listOf(
                    ConversationDto(id = 1, isGroup = true, name = "Team Chat", unreadCount = 3),
                    ConversationDto(id = 2, isGroup = false, name = "Alice"),
                ),
                wsConnected = true
            ),
            currentUserId = 1L,
            themeMode = ThemeMode.HACKER,
            onToggleThemeMode = {},
            onConversationClicked = {},
            onNewConversationClicked = {},
            onRefresh = {},
            onLogout = {},
        )
    }
}
