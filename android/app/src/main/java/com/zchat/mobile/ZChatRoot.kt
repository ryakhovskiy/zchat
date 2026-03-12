package com.zchat.mobile

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import androidx.navigation.NavType
import com.zchat.mobile.feature.auth.AuthViewModel
import com.zchat.mobile.feature.auth.LoginScreen
import com.zchat.mobile.feature.auth.RegisterScreen
import com.zchat.mobile.feature.chat.ChatViewModel
import com.zchat.mobile.feature.chat.ConversationListScreen
import com.zchat.mobile.feature.chat.ConversationScreen
import com.zchat.mobile.feature.chat.NewConversationScreen

private object Routes {
    const val LOGIN = "login"
    const val REGISTER = "register"
    const val CONVERSATIONS = "conversations"
    const val CONVERSATION = "conversation"
    const val NEW_CONVERSATION = "new_conversation"
}

@Composable
fun ZChatRoot(
    isDarkMode: Boolean,
    onToggleDarkMode: (Boolean) -> Unit,
    authViewModel: AuthViewModel = hiltViewModel(),
    chatViewModel: ChatViewModel = hiltViewModel()
) {
    val authState by authViewModel.uiState.collectAsStateWithLifecycle()
    val listState by chatViewModel.listState.collectAsStateWithLifecycle()
    val activeState by chatViewModel.activeState.collectAsStateWithLifecycle()
    val newState by chatViewModel.newState.collectAsStateWithLifecycle()
    val navController = rememberNavController()
    val context = LocalContext.current

    // Global loading splash
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

    // Top-level: navigate to login whenever session is cleared (e.g. logout or token expiry)
    LaunchedEffect(authState.authenticated) {
        if (!authState.authenticated) {
            chatViewModel.disconnectRealtime()
            navController.navigate(Routes.LOGIN) {
                popUpTo(0) { inclusive = true }
            }
        }
    }

    // Determine start destination from auth state
    val startDestination = if (authState.authenticated) Routes.CONVERSATIONS else Routes.LOGIN

    NavHost(navController = navController, startDestination = startDestination) {

        // ── Auth screens ────────────────────────────────────────────────────────
        composable(Routes.LOGIN) {
            LoginScreen(
                state = authState,
                onUsernameChanged = authViewModel::onUsernameChange,
                onPasswordChanged = authViewModel::onPasswordChange,
                onRememberChanged = authViewModel::onRememberMeChange,
                onLoginClicked = authViewModel::login,
                onSwitchToRegister = {
                    authViewModel.switchToRegister()
                    navController.navigate(Routes.REGISTER)
                }
            )
            // Navigate to chat when authenticated
            LaunchedEffect(authState.authenticated) {
                if (authState.authenticated) {
                    navController.navigate(Routes.CONVERSATIONS) {
                        popUpTo(Routes.LOGIN) { inclusive = true }
                    }
                }
            }
        }

        composable(Routes.REGISTER) {
            RegisterScreen(
                state = authState,
                onUsernameChanged = authViewModel::onUsernameChange,
                onEmailChanged = authViewModel::onEmailChange,
                onPasswordChanged = authViewModel::onPasswordChange,
                onRememberChanged = authViewModel::onRememberMeChange,
                onRegisterClicked = authViewModel::register,
                onSwitchToLogin = {
                    authViewModel.switchToLogin()
                    navController.popBackStack()
                }
            )
            LaunchedEffect(authState.authenticated) {
                if (authState.authenticated) {
                    navController.navigate(Routes.CONVERSATIONS) {
                        popUpTo(Routes.LOGIN) { inclusive = true }
                    }
                }
            }
        }

        // ── Chat screens ────────────────────────────────────────────────────────
        composable(Routes.CONVERSATIONS) {
            // Connect realtime and load conversations once authenticated
            LaunchedEffect(authState.token) {
                if (!authState.token.isNullOrBlank()) {
                    chatViewModel.connectRealtime(authState.token)
                    chatViewModel.loadConversations()
                }
            }

            ConversationListScreen(
                state = listState,
                currentUserId = authState.currentUserId,
                isDarkMode = isDarkMode,
                onToggleDarkMode = onToggleDarkMode,
                onConversationClicked = { id ->
                    chatViewModel.selectConversation(id)
                    navController.navigate("${Routes.CONVERSATION}/$id")
                },
                onNewConversationClicked = {
                    navController.navigate(Routes.NEW_CONVERSATION)
                },
                onLogout = { authViewModel.logout() }
            )
        }

        composable(
            route = "${Routes.CONVERSATION}/{id}",
            arguments = listOf(navArgument("id") { type = NavType.LongType })
        ) { backStackEntry ->
            val conversationId = backStackEntry.arguments?.getLong("id") ?: return@composable
            
            // Re-select if process died and recreated
            LaunchedEffect(conversationId) {
                if (activeState.conversationId != conversationId) {
                    chatViewModel.selectConversation(conversationId)
                }
            }

            val conversation = listState.conversations.find { it.id == conversationId }

            ConversationScreen(
                state = activeState,
                conversation = conversation,
                currentUserId = authState.currentUserId,
                onBack = { navController.popBackStack() },
                onComposeTextChange = chatViewModel::onComposeTextChange,
                onSendClicked = chatViewModel::sendMessage,
                onStartEditing = chatViewModel::startEditing,
                onCancelEditing = chatViewModel::cancelEditing,
                onDeleteMessage = chatViewModel::deleteMessage,
                onFilePicked = { uri -> chatViewModel.uploadFile(uri, context) }
            )
        }

        composable(Routes.NEW_CONVERSATION) {
            NewConversationScreen(
                state = newState,
                currentUserId = authState.currentUserId,
                onBack = { navController.popBackStack() },
                onLoadUsers = chatViewModel::loadUsers,
                onCreateConversation = { ids, isGroup, name ->
                    chatViewModel.createConversation(ids, isGroup, name)
                    navController.navigate(Routes.CONVERSATIONS) {
                        popUpTo(Routes.CONVERSATIONS)
                    }
                }
            )
        }
    }
}
