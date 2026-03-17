# zChat Android (Kotlin) - Implementation Start

This folder contains the initial native Android client scaffold for `zchat`.

## Prerequisites

- **Java 17** (JDK) — required by the Kotlin/Gradle toolchain.
- **Android SDK** — compileSdk 34, minSdk 26, targetSdk 34.
- **Android Studio** (recommended) — or use the Gradle wrapper from the command line.

> All commands below assume you are in the `android/` directory.
> On Linux/macOS use `./gradlew`; on Windows use `gradlew.bat`.

## Build Commands

### Debug build (APK)

```bash
# Linux / macOS
./gradlew assembleDebug

# Windows
gradlew.bat assembleDebug
```

Output APK: `app/build/outputs/apk/debug/app-debug.apk`

### Release build (APK)

```bash
./gradlew assembleRelease        # requires signing config
```

Output APK: `app/build/outputs/apk/release/app-release.apk`

### Build App Bundle (AAB) for Play Store

```bash
./gradlew bundleRelease          # requires signing config
```

Output: `app/build/outputs/bundle/release/app-release.aab`

## Testing

### Unit tests

```bash
./gradlew testDebugUnitTest
```

### Instrumented (on-device / emulator) tests

```bash
./gradlew connectedAndroidTest
```

### Run all checks (lint + tests)

```bash
./gradlew check
```

## Install & Run

### Install debug APK on a connected device / emulator

```bash
./gradlew installDebug
```

### Uninstall

```bash
adb uninstall com.zchat.mobile
```

## Clean

```bash
./gradlew clean
```

## Useful Gradle Tasks

| Task | Description |
|------|-------------|
| `assembleDebug` | Build debug APK |
| `assembleRelease` | Build release APK (needs signing) |
| `bundleRelease` | Build AAB for Play Store |
| `testDebugUnitTest` | Run unit tests (debug) |
| `connectedAndroidTest` | Run instrumented tests on device |
| `installDebug` | Install debug APK on device/emulator |
| `check` | Run lint + all tests |
| `clean` | Delete build outputs |
| `dependencies` | Print dependency tree |
| `lint` | Run Android Lint analysis |

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
