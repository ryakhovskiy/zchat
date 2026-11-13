# AGENTS.md

## Project: zchat frontend
Web interface built with modern React 18, Vite, and JavaScript.

## Setup & Dev Scripts
- **Install dependencies:** `npm install`
- **Start development server:** `npm run dev` (port 3000)
- **Build for production:** `npm run build`
- **Preview production build:** `npm run preview`
- **Lint code:** `npm run lint`
- **Docker build:** Multi-stage (`node:22-alpine` → `nginxinc/nginx-unprivileged:alpine-slim`, non-root, listens on 8080). Build args: `VITE_API_URL`, `VITE_WS_URL`, `VITE_VAPID_PUBLIC_KEY`. Optional build secret `extra_ca` for TLS-intercepting proxies.
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
Four themes, ids `light`, `dark`, `tech-green`, `tech-red`. Themes are **pure token sets**: one `[data-theme="<id>"]` block each in `src/styles/themes.css`, which also holds the theme-independent scales in `:root` (spacing `--space-*`, type `--text-*`, `--tap-size`, `--z-*`, motion, safe-area vars, `--app-h`). Components use tokens only: no hex/`rgb()`/named colours and no `[data-theme=...]` selectors outside `themes.css` (grep to check; exceptions need a one-line comment). A theme's personality comes from tokens: fonts, radii, shadows/glow, bubble styling, letter-spacing.

**Token list** (every theme block defines all of them):
- Surfaces: `--color-bg`, `--color-surface`, `--color-surface-raised`, `--color-surface-sunken`, `--color-scrim`, `--color-header-bg` (also drives `<meta name="theme-color">`), `--color-header-text`
- Text: `--color-text`, `--color-text-secondary`, `--color-text-muted`, `--color-on-accent`
- Accent: `--color-accent` (fills), `--color-accent-hover`, `--color-accent-text` (accent as text/icon/link), `--color-accent-soft`
- Lines: `--color-border`, `--color-border-strong`, `--color-focus-ring`
- Status: `--color-success`, `--color-danger`, `--color-danger-soft`, `--color-warning`, `--color-online`, `--color-on-success`, `--color-on-danger`
- Bubbles: `--bubble-out-bg|text|border|meta`, `--bubble-in-bg|text|border|meta`, `--bubble-radius`, `--bubble-radius-tail`; sender names `--sender-s|l`; avatars `--avatar-s|l|text` (hue comes from the username)
- Type: `--font-body`, `--font-mono`, `--font-meta` (timestamps, labels, headers), `--meta-letter-spacing`
- Shape and elevation: `--radius-sm|md|lg|full`, `--shadow-sm|md|lg`, `--shadow-overlay`, `--glow`, `--focus-glow`, `--border-width`
- emoji-mart (needs raw channels): `--emoji-rgb-bg|text|accent|input`

Rules: `--glow` and `--focus-glow` are `none` in light/dark, so never put them inside a comma-separated `box-shadow` list; use `--shadow-overlay` (elevation + glow already composed per theme) or a standalone `box-shadow: var(--glow)`. Tech Red's `--color-danger` is amber on purpose, so destructive actions differ from the crimson accent; destructive controls always carry an icon and a label. Each theme sets `color-scheme`. System font stacks only.

**Contrast:** all pairs must be WCAG AA (4.5:1 text, 3:1 icons/large). Run `node scripts/check-contrast.mjs` after touching a palette; it parses `themes.css`, asserts all four theme ids are present and checks 130+ pairs (exit code 1 on failure). Add a pair there when you add a new text-on-background combination.

**Switching and persistence:** `ThemeContext` exposes `{ theme, setTheme, themes, colorScheme }`. The Settings sheet (gear, `components/Common/ControlPanel.jsx`) holds the theme radiogroup (live swatches use a scoped `data-theme` so tokens resolve to the previewed theme) and the language segmented control. Stored in localStorage key `zchat-theme`; legacy `hacker` migrates to `tech-green`; unknown values fall back to the OS `prefers-color-scheme` (`light`/`dark`). The OS preference is followed live only until the user picks a theme. After mount `ThemeContext` copies the active `--color-header-bg` into `<meta name="theme-color">`.

**No-flash init script:** `public/theme-init.js`, loaded synchronously and *externally* from `<head>` in `index.html` (not inline, so a CSP without `unsafe-inline` keeps working). It sets `data-theme` before React mounts, migrates `hacker`, and sets the meta colour from a small id-to-colour map. localStorage access is wrapped in try/catch.

**Adding a theme:**
1. Add a `[data-theme="<id>"]` block to `src/styles/themes.css` defining every token above (copy an existing one).
2. Add the id to `THEMES` in `src/utils/theme.js` and to `HEADER` (with the header colour) in `public/theme-init.js`.
3. Add `theme.name_<id with - replaced by _>` to all three `src/locales/*/translation.json` and an icon in `THEME_ICONS` in `ControlPanel.jsx`.
4. Add the id to `EXPECTED` in `scripts/check-contrast.mjs`, run it, and fix any pair below AA.
5. Check the screens (auth, list, chat, sheets, call UI) in the new theme at 320, 390, 768 and 1440 px wide.

**Layout:** phone is under 768px (single pane, chat header is the top bar, `data-view="list|chat"` on `.app-layout`), tablet 768-1023px (two panes, ~300px sidebar), desktop 1024px+. Media queries cannot use custom properties, so breakpoints are literals (documented as `--bp-*` in `themes.css`). Use `var(--app-h)` rather than `100vh`; `useAppHeight` keeps it equal to the visual viewport so the composer stays above the on-screen keyboard. Input type is detected with `(pointer: coarse)` (`useCoarsePointer`), never from the width.

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
- **Container proxy** (`docker/nginx.conf`): `/api`, `/ws`, `/app` proxied to `http://backend:8000` over the Compose `web` network, with WebSocket upgrade headers; forwards `CF-Connecting-IP` as `X-Real-IP` (Cloudflare Tunnel). `nginx.conf` is the separate host-level config used by `deployment.md`.
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
