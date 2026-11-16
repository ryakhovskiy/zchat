# Common rules for all workers

You are one of five workers: frontend, backend, deployment, qa, reviewer. The lead coordinates. Your role file says which workspace you use.

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
- If untracked setup files (such as `.env`) are missing, copy them from the main checkout or create them from `.env.example`, and mention it in your report.

### If you work on main
- Other main roles work in the same tree, and the lead's merges land here. Stay inside your role's files.
- Before you commit, check `git status` and stage only your own files. Never run `git reset --hard`, `git checkout .`, `git stash`, `git clean`, or rebase: they can destroy other workers' uncommitted work.
- Commit small and often, with clear messages.
- After the lead tells you a branch was merged, rebuild and rerun before trusting earlier results. If files change under you unexpectedly, check `git log`: it is most likely a merge. Don't "fix" changes you didn't make; message their owner if they block you.

## Ports
Dev servers in different workspaces must not collide. Set ports through environment variables, not by editing shared config:
- main checkout: web 3000, api 8080
- frontend worktree: web 3001, api 8081
- backend worktree: web 3002, api 8082

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
