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
import com.zchat.mobile.feature.chat.ConversationListViewModel
import com.zchat.mobile.feature.chat.ConversationViewModel
import com.zchat.mobile.feature.chat.ConversationListScreen
import com.zchat.mobile.feature.chat.ConversationScreen
import com.zchat.mobile.feature.chat.NewConversationScreen
import com.zchat.mobile.feature.settings.SettingsScreen

private object Routes {
    const val LOGIN = "login"
    const val REGISTER = "register"
    const val CONVERSATIONS = "conversations"
    const val CONVERSATION = "conversation"
    const val NEW_CONVERSATION = "new_conversation"
    const val SETTINGS = "settings"
}

@Composable
fun ZChatRoot(
    isDarkMode: Boolean,
    onToggleDarkMode: (Boolean) -> Unit,
    authViewModel: AuthViewModel = hiltViewModel(),
    listViewModel: ConversationListViewModel = hiltViewModel(),
    convViewModel: ConversationViewModel = hiltViewModel()
) {
    val authState by authViewModel.uiState.collectAsStateWithLifecycle()
    val listState by listViewModel.listState.collectAsStateWithLifecycle()
    val activeState by convViewModel.state.collectAsStateWithLifecycle()
    val newState by listViewModel.newState.collectAsStateWithLifecycle()
    val incomingCall by listViewModel.incomingCall.collectAsStateWithLifecycle()
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
            listViewModel.disconnectRealtime()
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
                },
                onSettingsClicked = { navController.navigate(Routes.SETTINGS) }
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
                },
                onSettingsClicked = { navController.navigate(Routes.SETTINGS) }
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
                    listViewModel.connectRealtime(authState.token)
                    listViewModel.loadConversations()
                }
            }

            ConversationListScreen(
                state = listState,
                currentUserId = authState.currentUserId,
                isDarkMode = isDarkMode,
                incomingCall = incomingCall,
                onToggleDarkMode = onToggleDarkMode,
                onConversationClicked = { id ->
                    convViewModel.selectConversation(id)
                    listViewModel.resetUnread(id)
                    navController.navigate("${Routes.CONVERSATION}/$id")
                },
                onNewConversationClicked = {
                    navController.navigate(Routes.NEW_CONVERSATION)
                },
                onRefresh = { listViewModel.loadConversations() },
                onLogout = { authViewModel.logout() },
                onSettingsClicked = { navController.navigate(Routes.SETTINGS) },
                onRejectCall = { listViewModel.rejectIncomingCall() },
                onDismissCall = { listViewModel.dismissIncomingCall() }
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
                    convViewModel.selectConversation(conversationId)
                }
            }

            val conversation = listState.conversations.find { it.id == conversationId }

            ConversationScreen(
                state = activeState,
                conversation = conversation,
                currentUserId = authState.currentUserId,
                apiBaseUrl = convViewModel.serverConfig.apiBaseUrl,
                onBack = { navController.popBackStack() },
                onComposeTextChange = convViewModel::onComposeTextChange,
                onSendClicked = convViewModel::sendMessage,
                onStartEditing = convViewModel::startEditing,
                onCancelEditing = convViewModel::cancelEditing,
                onDeleteMessage = convViewModel::deleteMessage,
                onFilePicked = { uri -> convViewModel.uploadFile(uri, context) }
            )
        }

        composable(Routes.NEW_CONVERSATION) {
            LaunchedEffect(Unit) {
                listViewModel.navigateToConversation.collect { id ->
                    convViewModel.selectConversation(id)
                    listViewModel.resetUnread(id)
                    navController.navigate("${Routes.CONVERSATION}/$id") {
                        popUpTo(Routes.CONVERSATIONS)
                    }
                }
            }

            NewConversationScreen(
                state = newState,
                currentUserId = authState.currentUserId,
                onBack = { navController.popBackStack() },
                onLoadUsers = listViewModel::loadUsers,
                onCreateConversation = { ids, isGroup, name ->
                    listViewModel.createConversation(ids, isGroup, name)
                }
            )
        }

        composable(Routes.SETTINGS) {
            SettingsScreen(onBack = { navController.popBackStack() })
        }
    }
}
