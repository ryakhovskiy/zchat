# AGENTS.md

## Project: zchat Android
A native Android mobile application built with Jetpack Compose and Kotlin.

## Setup & Dev Scripts
- **Build:** `./gradlew assembleDebug` (Linux/Mac) or `gradlew.bat assembleDebug` (Windows).
- **Unit Tests:** `./gradlew testDebugUnitTest` or `gradlew.bat testDebugUnitTest`.
- **Instrumented Tests:** `./gradlew connectedAndroidTest` or `gradlew.bat connectedAndroidTest`.
- **Kotlin/Java Target:** Java 17 compatibility.
- **SDK:** compileSdk 34, minSdk 26, targetSdk 34.
- **Package:** `com.zchat.mobile`, version 0.1.0 (versionCode 1).

## Tech Stack & Libraries
- **Core UI:** Jetpack Compose (BOM 2025.01.00), Material 3, and Compose Navigation (`navigation-compose`).
- **Language & Concurrency:** Kotlin 2.1.0, Kotlin Coroutines/Flows (`kotlinx-coroutines-android:1.9.0`).
- **Dependency Injection:** Dagger Hilt (`hilt-android:2.55`) paired with KSP (`ksp:2.1.0-1.0.29`), `hilt-navigation-compose:1.2.0`.
- **Networking:** Retrofit 2 (`2.11.0`) with OkHttp (`4.12.0`) logging interceptor.
- **Serialization:** Moshi (`1.15.1`), utilizing KSP for code generation via `moshi-kotlin-codegen`.
- **Local Storage:** AndroidX DataStore (`datastore-preferences:1.1.1`) replacing SharedPreferences.
- **Lifecycle:** `lifecycle-viewmodel-compose:2.8.7`, `lifecycle-runtime-compose:2.8.7`.
- **Build System:** Gradle Wrapper with Kotlin DSL (`build.gradle.kts`, `settings.gradle.kts`).

## Code Patterns & Architecture

### MVVM with StateFlow
```
UI Layer (Jetpack Compose screens)
  ↓ collectAsStateWithLifecycle()
ViewModel (StateFlow<UiState>)
  ↓ calls
Repository Layer (AuthRepository, ChatRepository)
  ↓ calls
Data Sources (Retrofit APIs, OkHttp WebSocket, DataStore)
```

### Package Structure
```
com.zchat.mobile/
├── MainActivity.kt              # @AndroidEntryPoint, single-activity Compose host
├── ZChatApp.kt                  # @HiltAndroidApp application class
├── ZChatRoot.kt                 # NavHost + auth-based navigation
├── di/
│   └── NetworkModule.kt         # @Singleton Hilt module: Moshi, OkHttpClient, Retrofit, all 6 API interfaces
├── data/
│   ├── local/
│   │   └── AuthTokenStore.kt    # DataStore wrapper with in-memory cache
│   ├── remote/
│   │   ├── api/
│   │   │   └── ZChatApi.kt      # 6 Retrofit interfaces: AuthApi, UsersApi, ConversationsApi, FilesApi, BrowserApi, MessagesApi
│   │   ├── dto/
│   │   │   └── AuthDtos.kt      # 8+ Moshi @JsonClass DTOs
│   │   └── network/
│   │       ├── AuthInterceptor.kt    # OkHttp interceptor, reads token from mem cache
│   │       └── ZChatWebSocketClient.kt  # OkHttp WebSocket + Moshi JSON + SharedFlow events
│   └── repository/
│       ├── AuthRepository.kt    # Login, register, logout, bootstrap session
│       └── ChatRepository.kt    # Conversations, messages, users, WS connection
└── feature/
    ├── auth/
    │   ├── AuthViewModel.kt     # AuthUiState: loading, authenticated, credentials, error
    │   └── AuthScreen.kt        # LoginScreen + RegisterScreen composables
    └── chat/
        ├── ChatViewModel.kt     # ChatUiState: conversations, messages (Map<Long, List>), wsConnected
        ├── ConversationListScreen.kt  # Inbox with unread badges, WS indicator, FAB
        ├── ConversationScreen.kt      # Message list, compose bar, edit mode
        └── NewConversationScreen.kt   # User multi-select with online badges
```

### Navigation Routes
Defined in `ZChatRoot.kt` via `Routes` object:
| Route | Args | Screen |
|-------|------|--------|
| `LOGIN` | — | LoginScreen |
| `REGISTER` | — | RegisterScreen |
| `CONVERSATIONS` | — | ConversationListScreen |
| `CONVERSATION/{id}` | conversationId: Long | ConversationScreen |
| `NEW_CONVERSATION` | — | NewConversationScreen |

Auth-based navigation via `LaunchedEffect` watching `AuthUiState.authenticated`.

### Dependency Injection (Hilt)
Single `NetworkModule` (`@Singleton`) provides:
- `Moshi` → used by Retrofit converter + WebSocket JSON handling
- `OkHttpClient` → with `AuthInterceptor` + `HttpLoggingInterceptor`
- `Retrofit` → base URL from `BuildConfig.API_BASE_URL`, Moshi converter
- 6 API interfaces → created from Retrofit
- ViewModels auto-provided by Hilt (`@HiltViewModel`)

### Build Variants
| Variant | API_BASE_URL | WS_BASE_URL | WS_ORIGIN |
|---------|-------------|-------------|-----------|
| `debug` | `http://10.0.2.2:8000/api/` | `ws://10.0.2.2:8000/ws` | `http://localhost:3000` |
| `release` | Production URL | Production URL | Production URL |

`10.0.2.2` is the Android emulator alias for host `localhost`.

### WebSocket Integration
- **Client:** `ZChatWebSocketClient` wraps OkHttp WebSocket with Moshi JSON
- **Auth:** Bearer token in `Sec-WebSocket-Protocol: bearer, <token>` + `Origin` header
- **Event flow:** `MutableSharedFlow<Map<String, Any?>>` with 64-msg buffer, replay=0
- **Handled events:** `message`, `message_edited`, `message_deleted`, `messages_read`, `user_online`, `user_offline`
- **Connection lifecycle:** initiated by `ChatRepository` on login; ViewModel collects events via `SharedFlow`

### Session Persistence
- `AuthTokenStore` wraps AndroidX DataStore Preferences
- **Keys:** `token`, `username`, `user_id`, `remember_me` (boolean)
- **In-memory cache:** `memCache` field used by `AuthInterceptor` to avoid `runBlocking()` on OkHttp thread
- **Bootstrap flow:** `AuthViewModel.init` → `bootstrapSession()` → validates saved token → falls back to LOGIN if invalid

### DTOs (Moshi `@JsonClass(generateAdapter = true)`)
| DTO | Key Fields |
|-----|-----------|
| `UserDto` | `id`, `username`, `email`, `isOnline` |
| `AuthResponseDto` | `accessToken`, `tokenType`, `user` |
| `LoginRequestDto` | `username`, `password`, `rememberMe` |
| `RegisterRequestDto` | `username`, `email`, `password` |
| `MessageDto` | `id`, `conversationId`, `content`, `senderId`, `senderUsername`, `filePath`, `fileType`, `createdAt`, `isRead`, `isEdited`, `isDeleted` |
| `ConversationDto` | `id`, `name`, `isGroup`, `updatedAt`, `participants`, `unreadCount`, `lastMessage` |
| `CreateConversationRequestDto` | `participantIds`, `isGroup`, `name` |
| `SendMessageRequestDto` | `content`, `filePath`, `fileType` |

### Manifest & Permissions
```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />  <!-- Android 13+ -->
<uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />   <!-- File attachments -->
```
`android:usesCleartextTraffic="true"` is set — disable for release builds.

## Coding Rules
- Migrate/avoid legacy Android Views entirely. All UI work must be done natively in Jetpack Compose unless interacting with legacy Android system constraints.
- Avoid passing massive objects between navigation graphs; pass IDs and fetch cleanly.
- Keep Hilt modules separated intuitively by feature or layer.
- When adding new Compose libraries, pull from the Compose BOM instead of managing individual versions.
- Use `collectAsStateWithLifecycle()` for observing StateFlows in Compose.
- Keep DTOs in `data/remote/dto/` with `@JsonClass(generateAdapter = true)` for Moshi KSP codegen.

## Feature Parity Gaps (vs Web Frontend)
These features exist in the web frontend but are not yet implemented on Android:
- **File upload/download UI** — API interfaces exist but no UI built
- **Message edit/delete actions** — long-press handler is a stub (empty)
- **i18n** — web has EN/DE/RU; Android has no string resource translations
- **Theme persistence** — no dark/light mode toggle or persistence
- **Browser proxy** — API interface exists but no screen
- **Typing indicators** — not wired to UI
- **Unread count WS updates** — not fully wired from WebSocket events
- **Message list pagination** — loads all messages at once, no pagination
