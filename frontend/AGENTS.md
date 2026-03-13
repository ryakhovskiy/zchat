# AGENTS.md

## Project: zchat frontend
Web interface built with modern React 18, Vite, and JavaScript.

## Setup & Dev Scripts
- **Install dependencies:** `npm install`
- **Start development server:** `npm run dev` (port 3000)
- **Build for production:** `npm run build`
- **Preview production build:** `npm run preview`
- **Lint code:** `npm run lint`
- **Docker build:** Multi-stage (Node 18-alpine → nginx-alpine). Build args: `VITE_API_URL`, `VITE_WS_URL`.
- **Tests:** No test framework configured yet.

## Tech Stack & Libraries
- **Core:** React 18, React DOM.
- **Build Tool:** Vite 5 (via `@vitejs/plugin-react`).
- **Networking:** Axios for REST API requests.
- **Internationalization (i18n):** `i18next`, `react-i18next` with browser language detection. Translations: `src/locales/{en,de,ru}/translation.json`.
- **UI Widgets:** `emoji-mart` & `@emoji-mart/react` for emoji picker.
- **Linting:** ESLint 8 + `eslint-plugin-react`.

## Code Patterns & Architecture

### Component Hierarchy
```
App
├── ThemeProvider
│   └── AuthProvider
│       └── ChatApp
│           ├── Login / Register  [if not authenticated]
│           └── ChatProvider      [if authenticated]
│               └── CallProvider
│                   ├── CallOverlay
│                   └── ChatMain
│                       ├── ControlPanel (top bar: theme, language, logout)
│                       ├── Sidebar
│                       │   ├── ConversationList
│                       │   └── UserList (modal for new conversations)
│                       ├── ChatWindow (active) OR WebBrowser
│                       └── CallModal (during calls)
```
No explicit React Router — auth state toggles between Login/Register and ChatMain views.

### State Management (Context API)
All global state managed via React Contexts in `src/contexts/`. Prefer this over Redux unless a complex new state requirement arises.

| Context | State | Key Methods |
|---------|-------|-------------|
| **AuthContext** | `user`, `token`, `loading`, `wsClient` | `login()`, `register()`, `logout()`. Manages WebSocket lifecycle. Dispatches `UNAUTHORIZED_EVENT` on 401. |
| **ChatContext** | `conversations`, `messages`, `users`, `onlineUsers`, `selectedConversation`, `unreadCounts`, `isBrowserOpen` | `selectConversation()`, `loadMessages()`, `sendMessage()`, `editMessage()`, `deleteMessage()`, `createConversation()`. Listens to WS events. Integrates Notification API. |
| **CallContext** | `callState` (idle/calling/incoming/active/rejected), `localStream`, `remoteStream`, `callPeer` | `startCall()`, `acceptCall()`, `rejectCall()`, `endCall()`. Manages `RTCPeerConnection` with STUN servers (Google, Twilio). WebSocket signaling for WebRTC. |
| **ThemeContext** | `isDark` (persisted to localStorage) | Toggles `data-theme` attribute on `document.documentElement`. |

Custom hooks: `useAuth()`, `useChat()`, `useCall()`, `useTheme()`.

### API Service Layer (`src/services/api.js`)
All backend interaction centralized in one file:
- Axios instance with base URL from `import.meta.env.VITE_API_URL`
- Request interceptor: auto-attaches Bearer token from localStorage/sessionStorage
- Response interceptor: 401 triggers `UNAUTHORIZED_EVENT` and clears auth
- API namespaces: `authAPI`, `usersAPI`, `conversationsAPI`, `filesAPI`, `browserAPI`
- `WebSocketClient(token)`: connects to WS with bearer auth via `Sec-WebSocket-Protocol`

### WebSocket Integration
- Connection established in `AuthContext` on successful auth
- Event listeners registered in `ChatContext`: `message`, `user_online`, `user_offline`, `message_edited`, `message_deleted`, `messages_read`
- Call signaling in `CallContext`: `call_offer`, `call_answer`, `ice_candidate`, `call_end`, `call_rejected`
- Push notifications via Notification API when not viewing the active conversation

### Theme System
- CSS custom properties defined in `src/App.css` (e.g., `--bg-primary`, `--text-primary`, `--accent`)
- Dark theme (default): navy/teal palette (`#061E29`, `#1D546D`, `#5F9598`)
- Light theme: blush/lavender palette (`#FFF2F2`, `#A9B5DF`, `#7886C7`)
- Toggle via `data-theme` attribute on `<html>`, persisted in localStorage

### i18n
- Languages: English (`en`), German (`de`), Russian (`ru`)
- Resources loaded from `src/locales/{lang}/translation.json`
- Namespace-flat keys: `auth.sign_in_header`, `chat.type_message`, `user_list.selected_count`, etc.
- Language cycle in ControlPanel: `en` → `de` → `ru` → `en`
- Access via `const { t } = useTranslation()` hook

### Component Files
| Folder | Files | Purpose |
|--------|-------|---------|
| `Auth/` | `Login.jsx`, `Register.jsx`, `Auth.css` | Auth forms with validation |
| `Chat/` | `ChatWindow.jsx`, `ConversationList.jsx`, `CallModal.jsx`, `Chat.css`, `CallModal.css` | Core chat UI, message list, compose bar, right-click context menu (edit/delete) |
| `Browser/` | `WebBrowser.jsx`, `WebBrowser.css` | Embedded browser via `/api/browser/proxy` |
| `Common/` | `ControlPanel.jsx`, `ControlPanel.css` | Top bar: theme toggle, language switch, logout |
| `UserList/` | `UserList.jsx`, `UserList.css` | User selection modal for creating conversations |

### Environment & Proxy Config
- **Dev proxy** (`vite.config.js`): `/api` → `http://localhost:8000`, `/ws` → `ws://localhost:8000`
- **Production proxy** (`nginx.conf`): Same routes proxied to `http://backend:8000`, with WebSocket upgrade headers
- **Build-time env vars**: `VITE_API_URL` (default: `/api`), `VITE_WS_URL` (default: `/ws`)

## Code Style
- Use modern ES6+ concepts (arrow functions, destructuring, optional chaining).
- Prefer functional components with Hooks.
- Keep `App.css` and `AppLayout.css` focused; ensure UI remains clean and responsive.
- Keep components modular within domain-specific folders (`src/components/Auth`, `Browser`, `Chat`, `Common`, `UserList`).
- Abstract helper functions (like `emojiUtils.js`) to `src/utils/`.

## Known Gaps
- **No tests** — no test framework or test files exist.
- **No React Router** — auth-based UI switching only; no URL-based navigation.
- **No React Error Boundaries** — uncaught errors could crash the app.
- **No typing indicators** in ChatWindow UI (backend supports `typing` WS event).
- **No message search** functionality.
- **No offline/PWA support** — relies on live WebSocket connection.
- **No upload progress feedback** — file uploads work but have no progress UI.
