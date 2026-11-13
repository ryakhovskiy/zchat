# zChat Application Frontend

React 18 + Vite web client for the zChat real-time messenger. It ships four themes (Light, Dark, Tech Green, Tech Red), a mobile-first layout, and a web app manifest so it can be installed to the home screen. Agent and contributor conventions live in [AGENTS.md](AGENTS.md).

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start the development server (the backend must be running on port 8000):
```bash
npm run dev
```

The app is served at http://localhost:3000. Vite proxies `/api`, `/ws` and `/app` to `http://localhost:8000`.

Build-time variables (optional): `VITE_API_URL` (default `/api`), `VITE_WS_URL` (default `/ws`), `VITE_VAPID_PUBLIC_KEY` (Web Push).

## Available Scripts

- `npm run dev` - Run the development server
- `npm run build` - Build for production into `dist/`
- `npm run preview` - Preview the production build
- `npm run lint` - Lint with ESLint
- `npm run test:e2e` - Run the Playwright browser tests (needs an isolated test stack; see `tests/e2e/README.md`)
- `node scripts/check-contrast.mjs` - Check WCAG AA contrast of every theme token pair

## Project Structure

- `index.html`, `public/` - HTML entry, no-flash theme init script (`theme-init.js`), web app manifest and icons, push service worker
- `src/components/` - React components
  - `Auth/` - Login and registration
  - `Chat/` - Conversation list, chat window, composer, message actions, call overlay
  - `Common/` - Settings sheet, bottom sheet/popover primitive, icons, avatars, image viewer
  - `UserList/` - New conversation picker
- `src/contexts/` - React contexts (auth, chat, call, theme)
- `src/hooks/` - Shared hooks (media queries, viewport height, connection status, message gestures)
- `src/services/` - REST/WebSocket client and push registration
- `src/styles/` - Theme tokens (`themes.css`) and shared base styles (`base.css`)
- `src/utils/` - Utility functions
- `src/locales/` - English, German and Russian translations
- `scripts/` - Developer scripts (contrast checker)
- `tests/e2e/` - Playwright browser tests

## Themes

Themes are token sets in `src/styles/themes.css` (`light`, `dark`, `tech-green`, `tech-red`), chosen from the Settings sheet (gear icon) and stored in `localStorage` under `zchat-theme`. See the Theme System section of [AGENTS.md](AGENTS.md) for the token list and how to add a theme.
