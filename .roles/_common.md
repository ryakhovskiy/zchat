# Common rules for all workers

You are one of five workers: frontend, backend, deployment, qa, reviewer. The lead coordinates. Your role file says which workspace you use.

## Project facts
zchat is a chat app: a React 18 + Vite 5 frontend in plain JavaScript (`frontend/`, no TypeScript, no router) and a Go 1.26 REST + WebSocket backend on PostgreSQL only (`backend/`). Read the root `AGENTS.md` plus the `AGENTS.md` in your subproject before you start. They are the source of truth for commands, conventions, the API and WebSocket contract, and environment variables. If you change behavior they describe, update the matching `AGENTS.md` in the same branch.

## Herdr names
Other projects on the same Herdr server (for example `holdings`) already own the plain names `lead`, `frontend`, `backend`, `qa`, `reviewer` and `deployment`. Zchat's agents are `zchat-lead`, `zchat-frontend`, `zchat-backend`, `zchat-qa`, `zchat-reviewer` and `zchat-deployment`. Always use the prefixed names with `herdr agent prompt` and `herdr agent read`, or you will message the wrong project. Role names (frontend, qa, ...) in these files mean the matching `zchat-` agent.

## Real data: hands off
- The stack at `127.0.0.1:3000` (root `docker-compose.yml`, Compose project `zchat`, containers `zchat-*`, data in `./postgres-data`) holds the user's real accounts, messages and uploads. Never test against it, and don't stop, rebuild, recreate or delete it, or touch `./postgres-data`, without explicit approval from the lead.
- The disposable e2e stack (`bash e2e/run.sh ...`, Compose project `zchat-e2e`, `127.0.0.1:38080`) is the only stack tests may mutate. qa owns it. There is one shared instance, so don't run `reset` or `down --volumes` while qa is mid-run.
- The root `.env` and `frontend/.env` are gitignored. Never commit them or print their contents. Backend code never loads `.env` itself.

## Workspace

There are two setups:
- **Worktree roles (frontend, backend):** you have your own git worktree and work on your own branches.
- **Main roles (qa, reviewer, deployment):** you share the main checkout with each other. The lead merges finished branches into main.

### If you work in a worktree
- Work only inside your worktree. Never edit files in the main checkout or in another worker's worktree.
- Use one branch per task, named `<role>/<short-task-name>`, created from the latest main: `git switch -c <role>/<task> main`.
- Commit to your branch only. Never merge into main, never commit on main, never rebase main. The lead merges.
- If you need changes that have landed on main since you branched, run `git merge main` on your branch.
- Before reporting a task as done: commit everything, make sure the branch builds and its own tests pass, and include the branch name in your report.
- If untracked setup files are missing, create them and mention it in your report. The frontend needs `frontend/.env` made from `frontend/.env.example` (Vite does not read the root `.env`) and `npm install` in `frontend/`. The backend reads only process environment variables. Export them or use `backend/start.sh`, which supplies development-only secrets. The root `.env` matters only for Docker Compose.

### If you work on main
- Other main roles work in the same tree, and the lead's merges land here. Stay inside your role's files.
- Before you commit, check `git status` and stage only your own files. Never run `git reset --hard`, `git checkout .`, `git stash`, `git clean`, or rebase: they can destroy other workers' uncommitted work.
- Commit small and often, with clear messages.
- After the lead tells you a branch was merged, rebuild and rerun before trusting earlier results. If files change under you unexpectedly, check `git log`: it is most likely a merge. Don't "fix" changes you didn't make; message their owner if they block you.

## Ports
Dev servers in different workspaces must not collide, and must not collide with the real-data stack (web 3000 on the host; the backend's 8000 is only inside Compose). Set ports through environment variables, not by editing shared config:
- frontend worktree: web 3001, api 8001
- backend worktree: web 3002, api 8002
- main checkout (rarely needed): web 3003, api 8003
- e2e stack: 38080 (qa only)

How to apply them:
- Backend: `HTTP_PORT=<api>`. `CORS_ORIGINS` must include `http://localhost:<web>`, otherwise WebSocket connections are rejected. `backend/start.sh` keeps a preset `HTTP_PORT`.
- Frontend: `PORT=<web>`. Vite's dev proxy is hardcoded to `localhost:8000`, so with any other api port don't rely on it. Put absolute URLs in `frontend/.env` (copy `frontend/.env.example`): `VITE_API_URL=http://localhost:<api>/api` and `VITE_WS_URL=ws://localhost:<api>/ws`.
- Database: the backend needs its own PostgreSQL. Use a throwaway container or database for your worktree and point `POSTGRES_HOST`, `POSTGRES_PORT` and `POSTGRES_DB` at it. Never reuse the real-data database. `127.0.0.1:5432` on this host is already taken by something else, so don't assume it is yours.

## Communication
- Coordinate directly with other workers through Herdr messaging (`herdr agent prompt <name> "..."`). Address them by name. Don't route routine coordination through the lead.
- Make routine decisions autonomously. Don't ask permission for things inside your role's scope.
- Message the lead only with completed work, unresolved blockers, or important decisions needing input. Skip chatter and routine progress updates.
- Don't address the user. The lead is the only agent that talks to the user.
- Keep messages to other workers specific and self-contained: what you need or changed, which files, endpoints, or branch, and what you expect back.

## Working standards
- Don't refactor unrelated code or add dependencies without telling the affected workers.
- If a task is ambiguous, state your assumption and proceed, unless a wrong guess would be costly.
- Never claim something works unless you ran it.

## Final report to the lead (only when your assigned work is complete)
- **Status:** done / partial / blocked
- **Branch:** name (worktree roles), or "main"
- **What I did:** 2-5 bullets
- **Files changed:** list
- **How I verified:** commands run and results
- **Open issues / decisions needing input:** bullets, or "none"
Keep it concise.
