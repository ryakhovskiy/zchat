package com.zchat.mobile.feature.chat

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.zchat.mobile.R
import com.zchat.mobile.data.remote.dto.ConversationDto
import com.zchat.mobile.data.remote.dto.MessageDto

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConversationScreen(
    state: ActiveConversationState,
    conversation: ConversationDto?,
    currentUserId: Long?,
    apiBaseUrl: String,
    onBack: () -> Unit,
    onComposeTextChange: (String) -> Unit,
    onSendClicked: () -> Unit,
    onStartEditing: (MessageDto) -> Unit,
    onCancelEditing: () -> Unit,
    onDeleteMessage: (Long, Long) -> Unit,
    onFilePicked: (Uri) -> Unit,
    onCallClicked: () -> Unit = {},
) {
    val messages = state.messages[state.conversationId] ?: emptyList()
    val listState = rememberLazyListState()
    val focusManager = LocalFocusManager.current

    val filePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        if (uri != null) {
            onFilePicked(uri)
        }
    }

    // Scroll to bottom when new messages arrive
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) {
            listState.animateScrollToItem(messages.size - 1)
        }
    }

    val title = conversation?.name
        ?: conversation?.participants
            ?.filter { it.id != currentUserId }
            ?.joinToString(", ") { it.username }
        ?: state.conversationId?.let { "Conversation #$it" }
        ?: "Chat"

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title, maxLines = 1) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    if (conversation?.isGroup == false) {
                        IconButton(onClick = onCallClicked) {
                            Icon(Icons.Default.Call, contentDescription = "Call")
                        }
                    }
                }
            )
        }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .imePadding()
        ) {
            // Messages list
            Box(modifier = Modifier.weight(1f)) {
                when {
                    state.loading -> CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
                    messages.isEmpty() -> Text(
                        stringResource(R.string.msg_no_messages),
                        modifier = Modifier.align(Alignment.Center),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center
                    )
                    else -> LazyColumn(
                        state = listState,
                        modifier = Modifier.fillMaxSize(),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(
                            horizontal = 12.dp,
                            vertical = 8.dp
                        )
                    ) {
                        items(messages, key = { it.id }) { message ->
                            var showMenu by remember { mutableStateOf(false) }

                            Box {
                                MessageBubble(
                                    message = message,
                                    isOwn = message.senderId == currentUserId,
                                    apiBaseUrl = apiBaseUrl,
                                    onLongPress = {
                                        if (message.senderId == currentUserId) {
                                            showMenu = true
                                        }
                                    }
                                )
                                
                                DropdownMenu(
                                    expanded = showMenu,
                                    onDismissRequest = { showMenu = false }
                                ) {
                                    DropdownMenuItem(
                                        text = { Text(stringResource(R.string.action_edit)) },
                                        onClick = {
                                            showMenu = false
                                            onStartEditing(message)
                                        }
                                    )
                                    DropdownMenuItem(
                                        text = { Text(stringResource(R.string.action_delete)) },
                                        onClick = {
                                            showMenu = false
                                            onDeleteMessage(message.id, message.conversationId)
                                        }
                                    )
                                }
                            }
                        }
                    }
                }
            }

            // Edit mode indicator
            if (state.editingMessage != null) {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    color = MaterialTheme.colorScheme.secondaryContainer
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Default.Edit, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(
                            "${stringResource(R.string.action_edit)}: ${state.editingMessage.content.take(60)}",
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.weight(1f)
                        )
                        IconButton(onClick = onCancelEditing, modifier = Modifier.size(24.dp)) {
                            Icon(Icons.Default.Close, contentDescription = stringResource(R.string.action_cancel), modifier = Modifier.size(16.dp))
                        }
                    }
                }
                HorizontalDivider()
            }

            // Typing indicator
            if (state.typingUsers.isNotEmpty()) {
                val typingText = if (state.typingUsers.size == 1) {
                    stringResource(R.string.typing_indicator, state.typingUsers.first())
                } else {
                    stringResource(R.string.typing_indicator, state.typingUsers.joinToString(", "))
                }
                Text(
                    text = typingText,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
                )
            }

            // Compose bar
            if (!state.error.isNullOrBlank()) {
                Text(
                    state.error,
                    modifier = Modifier.padding(horizontal = 12.dp),
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall
                )
            }
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = { filePickerLauncher.launch("*/*") }) {
                    Icon(
                        androidx.compose.material.icons.Icons.Default.Add,
                        contentDescription = "Attach file",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                OutlinedTextField(
                    value = state.composingText,
                    onValueChange = onComposeTextChange,
                    modifier = Modifier.weight(1f),
                    placeholder = { Text(stringResource(R.string.hint_message)) },
                    maxLines = 4,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = { focusManager.clearFocus(); onSendClicked() }),
                    shape = RoundedCornerShape(24.dp)
                )
                Spacer(Modifier.width(8.dp))
                IconButton(
                    onClick = { focusManager.clearFocus(); onSendClicked() },
                    enabled = state.composingText.isNotBlank() && !state.isSending,
                    modifier = Modifier
                        .size(48.dp)
                        .clip(CircleShape)
                        .background(
                            if (state.composingText.isNotBlank())
                                MaterialTheme.colorScheme.primary
                            else
                                MaterialTheme.colorScheme.surfaceVariant
                        )
                ) {
                    if (state.isSending) {
                        CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(
                            Icons.AutoMirrored.Filled.Send,
                            contentDescription = stringResource(R.string.action_send),
                            tint = if (state.composingText.isNotBlank())
                                MaterialTheme.colorScheme.onPrimary
                            else
                                MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun MessageBubble(
    message: MessageDto,
    isOwn: Boolean,
    apiBaseUrl: String,
    onLongPress: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isOwn) Arrangement.End else Arrangement.Start
    ) {
        Box(
            modifier = Modifier
                .widthIn(max = 280.dp)
                .clip(
                    RoundedCornerShape(
                        topStart = 16.dp,
                        topEnd = 16.dp,
                        bottomEnd = if (isOwn) 4.dp else 16.dp,
                        bottomStart = if (isOwn) 16.dp else 4.dp
                    )
                )
                .background(
                    if (isOwn) MaterialTheme.colorScheme.primary
                    else MaterialTheme.colorScheme.surfaceVariant
                )
                .pointerInput(Unit) { detectTapGestures(onLongPress = { onLongPress() }) }
                .padding(horizontal = 12.dp, vertical = 8.dp)
        ) {
            Column {
                if (!isOwn && message.senderUsername != null) {
                    Text(
                        text = message.senderUsername,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
                
                if (message.filePath != null) {
                    if (message.fileType?.startsWith("image") == true) {
                        AsyncImage(
                            model = "${apiBaseUrl}uploads/${message.filePath.substringAfterLast("/")}",
                            contentDescription = "Attachment",
                            modifier = Modifier.padding(bottom = 4.dp).size(200.dp).clip(RoundedCornerShape(8.dp))
                        )
                    } else {
                        Row(
                            modifier = Modifier
                                .padding(bottom = 4.dp)
                                .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(8.dp))
                                .padding(8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(androidx.compose.material.icons.Icons.Default.Add, contentDescription = "File")
                            Spacer(Modifier.width(8.dp))
                            Text(
                                "File attachment",
                                color = MaterialTheme.colorScheme.onSurface,
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                    }
                }

                if (message.content.isNotBlank()) {
                    Text(
                        text = message.content,
                        color = if (isOwn) MaterialTheme.colorScheme.onPrimary
                        else MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
                val isEdited = message.isEdited == true
                val time = message.displayTime.take(16) // trim seconds/tz
                if (isEdited || time.isNotBlank()) {
                    val editedStr = stringResource(R.string.edited_suffix)
                    Text(
                        text = buildString {
                            if (time.isNotBlank()) append(time)
                            if (isEdited) append(" ").append(editedStr)
                        },
                        style = MaterialTheme.typography.labelSmall,
                        color = if (isOwn) MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.7f)
                        else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                        modifier = Modifier.align(Alignment.End)
                    )
                }
            }
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun ConversationScreenPreview() {
    com.zchat.mobile.ui.theme.ZChatTheme {
        ConversationScreen(
            state = ActiveConversationState(
                conversationId = 1L,
                messages = mapOf(
                    1L to listOf(
                        MessageDto(id = 1, conversationId = 1, content = "Hello!", senderId = 2, senderUsername = "alice", createdAt = "10:30"),
                        MessageDto(id = 2, conversationId = 1, content = "Hi there!", senderId = 1, senderUsername = "me", createdAt = "10:31"),
                    )
                )
            ),
            conversation = ConversationDto(id = 1, isGroup = false, name = "Alice"),
            currentUserId = 1L,
            apiBaseUrl = "http://localhost:8000/api/",
            onBack = {},
            onComposeTextChange = {},
            onSendClicked = {},
            onStartEditing = {},
            onCancelEditing = {},
            onDeleteMessage = { _, _ -> },
            onFilePicked = {},
            onCallClicked = {},
        )
    }
}
