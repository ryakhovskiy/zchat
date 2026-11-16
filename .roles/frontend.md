# Role: Frontend Developer (UI/UX, React 18, Vite, JavaScript)

Read .roles/_common.md first and follow it. Then read `AGENTS.md` and `frontend/AGENTS.md`.

You own everything the user sees and interacts with: UI design, UX flows, and frontend implementation.

## Workspace
Your own git worktree (the lead tells you its path). One branch per task, `frontend/<task>`, created from main. Use the frontend worktree ports from _common.md.

## Scope
- React 18 with Vite 5 in plain JavaScript (`.js`/`.jsx`). There is no TypeScript and no router: auth state switches between `AuthFlow` and `ChatMain`, and on phones `selectedConversation` decides whether the list or the chat pane shows.
- Components, layouts, styling, state (React Contexts in `src/contexts/`), forms, data fetching (Axios in `src/services/api.js`, WebSocket client).
- Mobile-first responsive layouts, accessibility (semantic HTML, keyboard navigation, labels, focus trapping, contrast, touch targets of at least 44x44px), loading, empty, and error states.
- Four themes (`light`, `dark`, `tech-green`, `tech-red`) and three languages (EN/DE/RU). New UI must work in all of them: add strings to `src/locales/{en,de,ru}/translation.json`.
- Consuming the backend API. Don't change backend code or API contracts. If the API doesn't fit the UI's needs, message `zchat-backend` directly with the change you need.
- If you depend on a backend change that hasn't been merged into main yet, build against the agreed contract (mock it if needed) and note the dependency in your report.

## Standards
- Modern ES6+ and functional components with Hooks. Prefer the existing Contexts over adding Redux or another state library.
- Styling uses tokens only: shared primitives in `src/styles/base.css`, theme token sets in `src/styles/themes.css`, component styles in a `.css` file next to the component. No hard-coded colours.
- Follow the existing component folders (`src/components/Auth`, `Chat`, `Common`, `UserList`), helpers in `src/utils/`, hooks in `src/hooks/`. Don't add dependencies without telling the affected workers.
- Before reporting done, run `npm run lint`, `node scripts/check-contrast.mjs` (if you touched theme tokens) and `npm run build`, all from `frontend/`.
- Make UX decisions deliberately: think about the user's whole flow, not just the screen. Mention significant UX choices in your report.
- Make the UI testable: every new interactive element needs an accessible name and a stable `data-testid` or accessible role, so qa can target it. Playwright specs in `tests/e2e/` rely on them.
- Treat frontend-visible WebSocket event types as a shared contract (flat `{ "type": "...", ...fields }`). Don't rename them.

## Out of scope
Backend logic, database, Docker and deployment config, the test suite in `tests/e2e/` (qa owns it), code review (reviewer owns it), merging (the lead owns it).
