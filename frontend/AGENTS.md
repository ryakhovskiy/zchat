# AGENTS.md

## Project: zchat frontend
Web interface built with React 18, Vite 5 and JavaScript (no TypeScript, no router). Four themes (Light, Dark, Tech Green, Tech Red), mobile-first, installable as a PWA.

## Setup & Dev Scripts
- **Install dependencies:** `npm install`
- **Start development server:** `npm run dev` (port 3000). First copy `.env.example` to `.env` here: the dev server has no env defaults and does not read the root `.env` (see Environment & Proxy Config)
- **Build for production:** `npm run build`
- **Preview production build:** `npm run preview`
- **Lint code:** `npm run lint` (ESLint 8, config in `.eslintrc.cjs`)
- **Browser tests:** `npm run test:e2e` (Playwright; needs an isolated stack, see Testing)
- **Contrast check:** `node scripts/check-contrast.mjs` (WCAG AA for every theme token pair)
- **Docker build:** Multi-stage (`node:22-alpine` → `nginxinc/nginx-unprivileged:alpine-slim`, non-root, listens on 8080). Build args: `VITE_API_URL`, `VITE_WS_URL`, `VITE_VAPID_PUBLIC_KEY`. Optional build secret `extra_ca` for TLS-intercepting proxies.

## Tech Stack & Libraries
- **Core:** React 18, React DOM.
- **Build Tool:** Vite 5 (via `@vitejs/plugin-react`).
- **Networking:** Axios for REST API requests; native WebSocket via `WebSocketClient`.
- **Internationalization (i18n):** `i18next`, `react-i18next` with browser language detection. Translations are bundled from `src/locales/{en,de,ru}/translation.json` (`i18next-http-backend` is installed but unused).
- **UI Widgets:** `emoji-mart` & `@emoji-mart/react` for the emoji picker. Icons are inline SVG in `components/Common/Icon.jsx`; fonts are system stacks (no web fonts, no UI kit).
- **Linting:** ESLint 8 + `eslint-plugin-react`.
- **Testing (dev only):** `@playwright/test` and `@axe-core/playwright`.

## Code Patterns & Architecture

### Component Hierarchy
```
main.jsx (imports App.css first, then App)
App
├── ThemeProvider
│   └── AuthProvider
│       └── ChatApp
│           ├── AuthFlow [if not authenticated]
│           │   └── Login / Register  (each wrapped in AuthShell, which includes the Settings gear)
│           └── ChatProvider [if authenticated]
│               └── CallProvider
│                   ├── CallOverlay  (full-screen on phones, corner card from 768px)
│                   └── ChatMain  (.app-layout, data-view="list|chat")
│                       ├── ConnectionBanner (offline / reconnecting)
│                       ├── aside.sidebar
│                       │   ├── SidebarHeader (avatar, Android link, new chat button, ControlPanel = Settings gear)
│                       │   └── ConversationList
│                       ├── main.chat-pane
│                       │   └── ChatWindow
│                       │       ├── header (back button on phones, avatar, call button)
│                       │       ├── MessageList → MessageBubble (grouped, date separators)
│                       │       ├── Composer (auto-growing input, attach, emoji, send)
│                       │       ├── MessageActions (action sheet on touch, context menu on desktop)
│                       │       ├── Sheet with EmojiPicker (reaction picker)
│                       │       └── ImageModal (lightbox)
│                       └── UserList (a Sheet: new conversation picker)
```
No React Router: auth state toggles between AuthFlow and ChatMain, and on phones `selectedConversation` decides whether the list or the chat pane is on screen.

### State Management (Context API)
All global state managed via React Contexts in `src/contexts/`. Prefer this over Redux unless a complex new state requirement arises.

| Context | State | Key Methods |
|---------|-------|-------------|
| **AuthContext** | `user`, `token`, `loading`, `wsClient`, `isAuthenticated` | `login()`, `register()`, `logout()`. Manages WebSocket lifecycle and push registration. Dispatches `UNAUTHORIZED_EVENT` on 401. |
| **ChatContext** | `conversations`, `messages` (per conversation id; `undefined` until first loaded), `users`, `onlineUsers`, `selectedConversation`, `unreadCounts`, `hasMoreMessages`, `loading` | `selectConversation()`, `loadConversations()`, `loadOlderMessages()`, `sendMessage()`, `editMessage()`, `deleteMessage()`, `reactToMessage()`, `createConversation()`, `setMessages()`. Listens to WS events. Raises a browser Notification for messages from others when their conversation isn't open or the window isn't focused. |
| **CallContext** | `callState` (idle/calling/incoming/active), `localStream`, `remoteStream`, `callPeer` | `startCall()`, `acceptCall()`, `rejectCall()`, `endCall()`. Manages `RTCPeerConnection` with STUN servers (Google, Twilio). WebSocket signaling for WebRTC. |
| **ThemeContext** | `theme`, `themes`, `colorScheme` ('light' or 'dark', for emoji-mart) | `setTheme(id)`. Sets `data-theme` on `document.documentElement`, persists to localStorage and syncs `<meta name="theme-color">`. See Theme System. |

Context hooks: `useAuth()`, `useChat()`, `useCall()`, `useTheme()`.

Other hooks (`src/hooks/`):
- `useMediaQuery.js`: `useMediaQuery(query)`, `useIsPhone()` (under 768px), `useCoarsePointer()` (touch-first input)
- `useAppHeight.js`: keeps `--app-height` equal to the visual viewport so the composer stays above the on-screen keyboard
- `useConnectionStatus.js`: `'online' | 'offline' | 'reconnecting'` for the banner
- `useMessageGestures.js`: long-press (450ms) opens the action sheet, swipe right replies, right-click on mouse

### API Service Layer (`src/services/api.js`)
All backend interaction centralized in one file:
- Axios instance with base URL from `import.meta.env.VITE_API_URL`
- Request interceptor: auto-attaches Bearer token from localStorage/sessionStorage
- Response interceptor: 401 triggers `UNAUTHORIZED_EVENT` and clears auth
- API namespaces: `authAPI`, `usersAPI`, `conversationsAPI`, `filesAPI`; helpers `getStoredToken()`, `clearAuthStorage()`
- `WebSocketClient(token)`: connects to WS with bearer auth via `Sec-WebSocket-Protocol`; reconnects with backoff; emits `disconnect` locally
- `src/services/pushNotifications.js`: Web Push registration against `public/sw.js` (VAPID key from `VITE_VAPID_PUBLIC_KEY` or the API)

### WebSocket Integration
- Connection established in `AuthContext` on successful auth
- Event listeners registered in `ChatContext`: `message`, `user_online`, `user_offline`, `message_edited`, `message_deleted`, `reaction_updated`; `messages_read` is handled in `ChatWindow`
- Call signaling in `CallContext`: `call_offer`, `call_answer`, `ice_candidate`, `call_end`, `call_rejected`
- Browser Notifications when the conversation isn't open or the window isn't focused, and Web Push through the service worker

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

**Contrast:** all pairs must be WCAG AA (4.5:1 text, 3:1 icons/large). Run `node scripts/check-contrast.mjs` after touching a palette; it parses `themes.css`, asserts all four theme ids are present and checks 170+ pairs (exit code 1 on failure). Add a pair there when you add a new text-on-background combination.

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
- Languages: English (`en`), German (`de`), Russian (`ru`); `<html lang>` follows the active language
- Resources bundled from `src/locales/{lang}/translation.json` (`src/i18n.js`)
- Namespace-flat keys: `auth.*`, `chat.*`, `user_list.*`, `settings.*`, `theme.*`, `call.*`, `common.*`. Add new keys to all three files and never rename existing ones; theme names use `theme.name_<id with - as _>`
- Language is chosen in the Settings sheet (segmented control, `ControlPanel.jsx`), not by cycling
- Access via `const { t } = useTranslation()` hook

### File & Folder Map
| Path | Files | Purpose |
|------|-------|---------|
| `index.html`, `public/` | `theme-init.js`, `manifest.webmanifest`, `icons/`, `sw.js`, `assets/images/zchat.png` | No-flash theme init, PWA manifest + icons (192, 512, maskable), push service worker, favicon/logo |
| `scripts/` | `check-contrast.mjs` | Contrast checker for `themes.css` |
| `src/styles/` | `themes.css`, `base.css` | Theme tokens and scales; reset, focus rings, buttons, inputs, skeleton, banner |
| `src/App.css`, `src/AppLayout.css` | | `App.css` only imports the two style files above; `AppLayout.css` is the shell (phone single pane, tablet/desktop two panes) |
| `src/components/Auth/` | `Login.jsx`, `Register.jsx`, `AuthShell.jsx` (+ `PasswordField`), `Auth.css` | Auth forms with validation, themed card, Settings gear |
| `src/components/Chat/` | `ChatWindow.jsx`, `MessageList.jsx`, `MessageBubble.jsx`, `Composer.jsx`, `MessageActions.jsx`, `EmojiPicker.jsx`, `ConversationList.jsx`, `CallModal.jsx`; styles in `ChatWindow.css` (header, messages, composer), `MessageActions.css`, `EmojiPicker.css`, `ConversationList.css`, `CallModal.css` | Chat UI: header, history with scroll anchoring, bubbles, composer, action sheet/context menu, reactions, list, call overlay |
| `src/components/Common/` | `ControlPanel.jsx` (Settings sheet), `Sheet.jsx`, `Icon.jsx`, `Avatar.jsx`, `ImageModal.jsx`, with `.css` next to each except `Icon` | Shared UI: Settings (theme + language + logout), bottom sheet/popover/modal primitive, icon set, initials avatar, lightbox |
| `src/components/UserList/` | `UserList.jsx`, `UserList.css` | New-conversation picker (a Sheet) |
| `src/contexts/` | `AuthContext`, `ChatContext`, `CallContext`, `ThemeContext` | Global state |
| `src/hooks/` | `useMediaQuery`, `useAppHeight`, `useConnectionStatus`, `useMessageGestures` | See State Management |
| `src/utils/` | `theme.js`, `avatar.js`, `emojiUtils.js`, `focus.js`, `pointerState.js`, `overlayStack.js` | Theme ids/storage; username-to-hue and initials; emoji/link helpers; shadow-DOM-aware tabbables and Tab trap; "is a touch down" tracking; topmost-overlay stack for Esc/Tab |
| `src/services/` | `api.js`, `pushNotifications.js` | REST, WebSocket client, push registration |
| `src/locales/` | `{en,de,ru}/translation.json` | Translations |
| `tests/e2e/` | Playwright specs, `README.md` | Browser acceptance tests (QA) |

### UI behaviours worth knowing
- **Overlays:** `Sheet` is a bottom sheet under 768px (docked right in short landscape), a popover under its anchor or a centred modal above. It closes with its X, a scrim tap or Esc, traps focus (including emoji-mart's shadow DOM) and restores it. Sheets, the call overlay and the lightbox share `overlayStack`, so only the topmost one handles Esc/Tab. A sheet opened by a long-press ignores input until the finger lifts.
- **Input type:** long-press vs right-click and Enter behaviour use `(pointer: coarse)`, never the viewport width. On touch keyboards Enter inserts a newline and the Send button sends.
- **Composer:** sends are scoped to the conversation and draft that started them (switching chats mid-send never clears another draft). Send and file errors show inline, not as `alert()`.
- **Messages:** consecutive messages from one sender group; the list stays pinned to the bottom unless the user scrolled up (then "Jump to latest" appears); deleted messages arrive with empty content and render as "Message deleted".

### Environment & Proxy Config
- **Dev proxy** (`vite.config.js`): `/api` and `/app` → `http://localhost:8000`, `/ws` → `ws://localhost:8000`. It only applies when `VITE_API_URL`/`VITE_WS_URL` are relative (`/api`, `/ws`); `.env.example` instead points them straight at `http://localhost:8000/api` and `ws://localhost:8000/ws`.
- **Container proxy** (`docker/nginx.conf`): `/api`, `/ws`, `/app` proxied to `http://backend:8000` over the Compose `web` network, with WebSocket upgrade headers; derives the client IP from `CF-Connecting-IP` and forwards it as `X-Real-IP` (Cloudflare Tunnel). It also sets the security headers (HSTS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`; no `Content-Security-Policy` yet, `public/theme-init.js` is external so one can be added without `unsafe-inline`), and serves `/manifest.webmanifest` as `application/manifest+json`. `nginx.conf` is a separate host-level (Ubuntu/Nginx) config; the old `deployment.md` guide it referred to has been removed.
- **Build-time env vars**: `VITE_API_URL`, `VITE_WS_URL`, `VITE_VAPID_PUBLIC_KEY` (optional). `vite.config.js` reads them from `frontend/.env` or the process environment and `src/services/api.js` has no fallback, so `npm run dev` needs `cp .env.example .env`. `/api` and `/ws` are only the defaults of the Docker build args (`Dockerfile`, Compose); the root `.env` is not loaded by Vite.

## Code Style
- Use modern ES6+ concepts (arrow functions, destructuring, optional chaining).
- Prefer functional components with Hooks.
- Styling is tokens only (see Theme System): shared primitives in `src/styles/base.css`, component styles in a `.css` file next to the component, no hard-coded colours.
- Keep components modular within domain-specific folders (`src/components/Auth`, `Chat`, `Common`, `UserList`).
- Put helpers in `src/utils/` and reusable hooks in `src/hooks/`.
- New interactive elements need an accessible name and a stable `data-testid` or role for QA; touch targets are at least 44x44px.

## Testing
- **Browser tests:** Playwright + axe under `tests/e2e/` (`npm run test:e2e`). They cover 7 viewports (320x640 to 1440x900) in all four themes, theme bootstrap, gestures, overlays, calls and regressions. Run them only against an isolated stack on a loopback URL (`E2E_BASE_URL`, `E2E_USERNAME`, `E2E_PASSWORD`, `E2E_PEER`), never real data. Setup, commands and fixtures are in `tests/e2e/README.md`.
- **Static checks:** `npm run lint` and `node scripts/check-contrast.mjs`.
- There are no unit tests.

## Known Gaps
- **No unit tests**, only the Playwright browser suite.
- **No React Router**: auth-based UI switching only; no URL-based navigation.
- **No React Error Boundaries**: uncaught errors could crash the app.
- **No typing indicators** in the chat UI (backend supports the `typing` WS event).
- **No message search**.
- **Installable but not offline:** the manifest makes it installable, but there is no offline caching (`public/sw.js` only handles push) and no offline send queue: a failed send stays in the composer and needs another Send.
- **Unused dependency:** `i18next-http-backend` (import kept in `src/i18n.js`, `.use(Backend)` commented out).
