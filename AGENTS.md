# Repository Guidelines

## Project Structure & Module Organization
`src/app` contains the Next.js App Router UI and API routes; OpenAI-compatible endpoints live under `src/app/api/v1*`, while dashboard APIs live under `src/app/api/*`. Shared UI, hooks, constants, and helpers are in `src/shared/*`. Routing and provider adapters are split between `src/sse/*` and `open-sse/*`. Local persistence and runtime services live in `src/lib/*` and `src/store/*`. Static assets are in `public/` and `images/`. Cloudflare Worker code is in `cloud/`, and Vitest tests live in `tests/unit/*.test.js`.

## Build, Test, and Development Commands
From the repo root:

- `cp .env.example .env && npm install` initializes local development.
- `npm run dev` starts the dashboard on port `20128`.
- `npm run build` creates the production build.
- `npm run start` runs the built app.
- `npx eslint .` runs the repo lint rules from `eslint.config.mjs`.

For the worker:

- `cd cloud && npm install && npm run dev` runs the Cloudflare Worker locally.
- `cd cloud && npm run deploy` deploys the worker with Wrangler.

For tests:

- `cd /tmp && npm install vitest` installs the test runner expected by `tests/package.json`.
- `cd tests && npm test` runs the Vitest suite.

## Coding Style & Naming Conventions
Use ESM JavaScript, 2-space indentation, double quotes, and semicolons to match the existing codebase. Keep React components in `PascalCase` (`UsageStats.js`), utilities and stores in `camelCase` (`providerStore.js`), and Next route handlers in folder-based `route.js` files. Prefer small modules and keep provider-specific logic inside `open-sse/` or `src/lib/oauth/services/`.

## Testing Guidelines
Vitest is used for unit coverage in `tests/`. Name new files `*.test.js` and mirror the runtime modules in descriptions and imports. There is no published coverage gate; add or update tests for routing, translation, embeddings, OAuth, or fallback changes before opening a PR.

## Commit & Pull Request Guidelines
Recent history follows Conventional Commit-style prefixes such as `feat(scope): ...`, `fix(scope): ...`, `refactor: ...`, and `docs: ...`. Prefer lowercase, imperative summaries with an optional scope. PRs should describe the user-visible change, link the relevant issue or discussion, list the commands you ran (`npm run build`, `cd tests && npm test`, etc.), and include screenshots for dashboard/UI updates.

## Security & Configuration Tips
Do not commit real secrets. Start from `.env.example`, set `JWT_SECRET`, `INITIAL_PASSWORD`, `API_KEY_SECRET`, and keep `DATA_DIR` outside the repo for local data. When changing sync, proxy, or auth flows, document any required environment variables in the PR.
