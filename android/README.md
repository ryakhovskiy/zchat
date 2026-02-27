# zChat Android (Kotlin) - Implementation Start

This folder contains the initial native Android client scaffold for `zchat`.

## Current status

- Kotlin + Jetpack Compose app module created.
- Hilt dependency injection wired.
- Retrofit + OkHttp API layer aligned with backend routes.
- DataStore token/session persistence added.
- WebSocket client added for `/ws` with headers:
  - `Sec-WebSocket-Protocol: bearer, <token>`
  - `Origin: <configured origin>`
- Minimal Compose shell implemented:
  - login screen
  - authenticated chat shell
  - conversation list loading
  - WS connect/disconnect + logout

## Important backend compatibility note

The backend WebSocket handler validates `Origin` strictly.
For native clients, keep `WS_ORIGIN` aligned with one of backend `CORS_ORIGINS` values.

Current debug defaults in `app/build.gradle.kts`:

- `API_BASE_URL = http://10.0.2.2:8000/api/`
- `WS_BASE_URL = ws://10.0.2.2:8000/ws`
- `WS_ORIGIN = http://localhost:3000`

Ensure backend env includes `http://localhost:3000` in `CORS_ORIGINS`.

## File map

- App bootstrap: `app/src/main/java/com/zchat/mobile/MainActivity.kt`
- Root UI: `app/src/main/java/com/zchat/mobile/ZChatRoot.kt`
- DI: `app/src/main/java/com/zchat/mobile/di/NetworkModule.kt`
- APIs: `app/src/main/java/com/zchat/mobile/data/remote/api/ZChatApi.kt`
- DTOs: `app/src/main/java/com/zchat/mobile/data/remote/dto/AuthDtos.kt`
- Auth store: `app/src/main/java/com/zchat/mobile/data/local/AuthTokenStore.kt`
- Repositories:
  - `app/src/main/java/com/zchat/mobile/data/repository/AuthRepository.kt`
  - `app/src/main/java/com/zchat/mobile/data/repository/ChatRepository.kt`
- WebSocket: `app/src/main/java/com/zchat/mobile/data/remote/network/ZChatWebSocketClient.kt`
- ViewModels:
  - `app/src/main/java/com/zchat/mobile/feature/auth/AuthViewModel.kt`
  - `app/src/main/java/com/zchat/mobile/feature/chat/ChatViewModel.kt`

## Next implementation steps

1. Replace placeholder chat shell with full parity screens:
   - conversations pane
   - message list
   - composer with attachments
2. Implement browser proxy UI (MVP scope).
3. Add unread/read state updates from WS event payloads.
4. Add upload flow with extension + size checks to match web behavior.
5. Add edit/delete message actions (WS + REST fallback).
6. Add i18n resources (en/de/ru) and theme persistence.
