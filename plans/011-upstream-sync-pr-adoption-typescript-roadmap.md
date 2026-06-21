# 011 — Upstream Sync, Latest PR Adoption, Production Hardening, TypeScript Migration, and LoggerJS Watchers

## Status

TODO — roadmap plan. Execute only after the current stabilization workstreams have clean review/QA evidence or are explicitly integrated into this roadmap.

## Goal

Bring this fork back in line with upstream, adopt the latest valuable upstream work, finish production hardening, migrate the whole project to strict TypeScript, then add LoggerJS-powered observability and configurable log watchers as the post-TypeScript phase. The final state must be a production-grade DurinDoor/9Router fork with OpenAI/Anthropic parity, stable streaming/proxy behavior, managed MCP gateway behavior, meaningful tests, compile-time type safety, and admin-managed log watcher delivery.

## Non-goals

- Do not rewrite to TypeScript before behavior is stable.
- Do not blindly merge upstream or PRs.
- Do not remove fork features just to reduce conflicts.
- Do not use `any` or explicit `unknown` as a shortcut in the TypeScript phase.
- Do not commit/push/merge without a separate review/integration gate.
- Do not add LoggerJS or log-watcher UI before the strict TypeScript migration is complete.

## Upstream baseline

- Fork remote: `origin https://github.com/bloodf/9router/`
- Upstream remote: `upstream https://github.com/decolua/9router.git`
- Current upstream PR source: GitHub merged PRs from `decolua/9router`.

## Latest 10 upstream merged PR candidates to adopt

These were collected with:

```bash
gh pr list --repo decolua/9router --state merged --limit 15 --json number,title,mergedAt,author,url
```

Treat these as adoption candidates, not automatic cherry-picks. Each needs conflict review, tests, and improvement opportunities.

| PR | Merged | Title | Adoption focus |
| --- | --- | --- | --- |
| #1576 | 2026-05-31 | fix: add opencode-go and xiaomi-tokenplan cases to connection test route | Provider/connection test parity |
| #1536 | 2026-05-29 | fix: never route GitHub Copilot Gemini/Claude models to /responses (#1062, #1119) | API routing correctness |
| #1437 | 2026-05-26 | feat(proxy-pools): add Deno Deploy relays and group proxy pool buttons | Proxy-pool UX + relay support |
| #1428 | 2026-05-26 | Reuse Gemini CLI project ID for usage | Gemini CLI usage correctness |
| #1366 | 2026-05-23 | fix(embeddings): forward Gemini output dimensions | Embeddings API parity |
| #1362 | 2026-05-23 | fix(eslint): resolve setState-in-effect errors in dashboard components | React correctness / lint burn-down |
| #1361 | 2026-05-23 | feat: update Antigravity flash model + fixes | Antigravity model support |
| #1360 | 2026-05-23 | feat: Add Cloudflare Workers proxy deployer and pool integration | Proxy deployment feature |
| #1354 | 2026-05-23 | fix: strip empty Read pages argument in OpenAI-to-Claude translator | Translator correctness |
| #1310 | 2026-05-21 | fix: decode Composer Cursor thinking output | Thinking/reasoning parity |

## Phase order

### Phase 0 — Freeze, inventory, and integration guard

1. Finish or quarantine current active worktrees: ST-03, MCP-01, PA-01/PA-02, CH-01.
2. Produce an integration state report: dirty files, worktree branches, tests known-green, tests known-red, and current HEADs.
3. Create an integration branch from the intended base.
4. STOP if unreviewed work would be overwritten.

Acceptance:

- `git status --short` recorded for main and all worktrees.
- Every active worktree is CLEAN, REVIEW-CLEAN, or BLOCKED with reason.
- Integration branch exists but no merge has occurred without a gate.

### Phase 1 — Sync upstream base safely

1. Fetch upstream.
2. Create an upstream-sync worktree/branch.
3. Compare fork delta against upstream by feature area, not raw file count.
4. Merge or rebase upstream into the fork branch only after an integration plan identifies conflict owners.
5. Run targeted tests for routing, translators, streams, MCP, dashboard, and build.

Acceptance:

- Upstream sync branch builds.
- No fork feature surface is lost.
- Conflict resolutions have fresh review.

### Phase 2 — Adopt latest 10 upstream PRs with improvements

For each PR candidate:

1. Inspect upstream diff and linked issues.
2. Determine if already present, conflicting, obsolete, or still needed.
3. Port the behavior manually or cherry-pick into an isolated worktree.
4. Improve the upstream implementation where this fork has stricter stability/parity requirements.
5. Add or update tests proving the behavior.
6. Run fresh review and QA review before marking the PR adopted.

Acceptance per PR:

- Adoption decision recorded: adopted / already present / rejected with reason.
- Tests cover the adopted behavior.
- No regression in translator, stream, MCP, or dashboard suites.

### Phase 3 — Complete production hardening backlog

Execute remaining stabilization workstreams before TypeScript:

- ST-04 resilience test suite.
- PA-03 public endpoint parity contract tests.
- MCP-02 retry/reconnect/session lifecycle.
- DEP-01/02 compatible dependency updates.
- CH-02/03 lint burn-down and stub disposition.
- UI-01 design-system alignment batches.

Acceptance:

- Each task has clean implementation review, clean QA review, and verification evidence.
- No TODO/stub/dead module remains without an explicit tracked decision.
- Build and targeted test suites pass.

### Phase 4 — TypeScript migration preparation

1. Add TypeScript tooling in a dedicated branch only after behavior stabilizes.
2. Define strict compiler policy: `strict`, `noImplicitAny`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`.
3. Define repo conventions for generated types, API schemas, provider schemas, stream events, MCP JSON-RPC messages, DB rows, and UI props.
4. Add typecheck CI as advisory first, then fatal once migration is complete.

Acceptance:

- `tsconfig.json` and migration rules reviewed.
- No TypeScript conversion starts without boundary type plan.

### Phase 5 — Final TypeScript migration

Convert after all behavior work is stable. This remains the last broad rewrite phase; post-TypeScript observability work must build on the typed boundaries instead of converting around them.

Rules:

- No explicit `any`.
- No explicit `unknown` in production code. Parse untrusted data at boundaries into typed schema outputs instead.
- Use discriminated unions for provider formats, stream events, MCP JSON-RPC messages, executor results, and error envelopes.
- Use branded/string-literal types for provider IDs, model IDs, connection IDs, key IDs, request IDs, and session IDs.
- Use generics only where they preserve real relationships, e.g. `Translator<SourceFormat, TargetFormat>`, `Executor<TRequest, TResponse>`, `McpRequest<TMethod, TParams, TResult>`.
- Use enums or `as const` maps for stable protocol values; do not scatter string literals.
- Type all public API request/response envelopes and every translator boundary.
- Convert route handlers, translator modules, executor modules, MCP gateway, DB repositories, services, then UI.
- Delete JS shims only after equivalent typed modules are tested.

Suggested order:

1. Add TypeScript config and shared protocol types.
2. Convert translator schema/constants and concern helpers.
3. Convert request/response translators.
4. Convert executors, stream utilities, and resilience helpers.
5. Convert MCP gateway and JSON-RPC types.
6. Convert DB/services.
7. Convert API route handlers.
8. Convert dashboard/shared UI components.
9. Enable fatal typecheck in CI.
10. Remove remaining JS-only compatibility shims.

Acceptance:

- `npm run typecheck` passes with strict settings.
- `grep -R "\bany\b\|\bunknown\b"` over source returns zero production-code hits, except generated/vendor files explicitly excluded.
- Build, unit, translator, MCP, endpoint, e2e/integration suites pass.
- Fresh review confirms type safety is meaningful, not cast-driven.

### Phase 6 — LoggerJS observability and configurable log watchers (post-TypeScript)

Add LoggerJS only after the strict TypeScript migration is complete. This phase turns DurinDoor into an operator-friendly observability control plane where admins can choose which log watchers are enabled and where their events are delivered.

LoggerJS evidence to review before implementation:

- LoggerJS describes integrations as opt-in collectors and transports as delivery sinks, with runtime-specific browser, Node, vendor, database, and core transports: <https://github.com/jskits/loggerjs/blob/4208cef468c331c21869c290af377530b999e148/docs/TRANSPORTS.md>
- Browser integrations include console/error/fetch/XHR/Web Vitals/performance/router/user-actions/service-worker/WebSocket collectors, and Node integrations include process crashes, diagnostics channel, HTTP framework/client, fetch, CLI/serverless, queue, database, Prisma, Redis, and BullMQ collectors: <https://github.com/jskits/loggerjs/blob/4208cef468c331c21869c290af377530b999e148/docs/INTEGRATIONS.md>
- Use the AI skill/doc guidance when available for package selection and migration strategy: <https://github.com/jskits/loggerjs/blob/4208cef468c331c21869c290af377530b999e148/docs/AI-SKILL.md>

Implementation slices:

1. Add typed logging domain model:
   - `LogWatcherId`, `LogWatcherKind`, `LogTransportKind`, `LogIntegrationKind`, `LogLevel`, `LogRedactionPolicy`, `LogRetentionPolicy`, and `LogWatcherStatus`.
   - Typed config envelopes for server-side watchers, browser-side watchers, and vendor/destination secrets.
   - Boundary parsers that validate untrusted watcher config without `any` or explicit `unknown` in production code.
2. Install only the minimal LoggerJS packages needed for the first slice:
   - likely `@loggerjs/node`, `@loggerjs/browser`, and `@loggerjs/processors` first;
   - add vendor packages (`@loggerjs/otel`, `@loggerjs/sentry`, `@loggerjs/datadog`, `@loggerjs/elastic`, `@loggerjs/loki`, `@loggerjs/cloudwatch`, `@loggerjs/database`) only when the matching watcher type is implemented and configured.
3. Add a server logging module:
   - production-safe default logger;
   - redaction processors for API keys, bearer tokens, cookies, OAuth codes, provider credentials, MCP keys, proxy URLs with credentials, and request bodies that may contain prompts;
   - crash/process integration if safe;
   - flush/close lifecycle for shutdown paths.
4. Add a browser logging module:
   - opt-in capture for console warnings/errors, browser errors, failed fetch/XHR, route changes, page lifecycle, and optionally Web Vitals;
   - no prompt/body capture by default;
   - local/offline storage only when the admin enables it.
5. Add a Log Watchers dashboard section:
   - route suggestion: `/dashboard/log-watchers` with sidebar entry under Observability;
   - list enabled/disabled watchers, transport type, runtime, health, dropped-count metadata, last delivery, retention, and redaction policy;
   - create/edit modal for watcher name, runtime, integration sources, level filters, redaction, sampling, retention, and transport destination;
   - one-time secret entry for vendor/API destinations, never reveal stored secrets;
   - test delivery button and per-watcher pause/resume/delete ConfirmModal.
6. Supported watcher/transport matrix, phased by risk:
   - Phase 6A local/safe: `memoryTransport`, `stdoutTransport`, `stderrTransport`, `fileTransport`, `rotatingFileTransport`, `browserHttpTransport` to an internal collector endpoint, IndexedDB local support export.
   - Phase 6B operator destinations: `nodeHttpTransport`, OTLP HTTP, Sentry, Datadog, Elasticsearch, Loki, CloudWatch, syslog.
   - Phase 6C specialized/local app: SQLite/Postgres/database transports, WebSocket live debug transport, service-worker transport, BroadcastChannel tab fan-out, worker transport.
   - Pretty transports are developer-display only and must not be sold as durable production delivery.
7. Add collector/storage endpoints only after threat modeling:
   - local collector endpoint for browser logs;
   - DB persistence schema if watchers need durable local history;
   - retention/pruning jobs;
   - export/download path for support bundles.
8. Add tests:
   - typed config parser tests;
   - redaction tests proving secrets and prompts are not leaked;
   - transport factory tests for enabled/disabled/missing-secret states;
   - API route tests for watcher CRUD and delivery test;
   - browser logger tests for opt-in captures;
   - UI tests for create/edit/pause/delete/test flows.

Acceptance:

- LoggerJS integration is typed end-to-end and follows the no-`any`, no-explicit-`unknown` production-code rule.
- Log watcher UI can enable only transports whose package/config/runtime prerequisites are present.
- Secrets are never shown after creation and are redacted from logs, errors, toasts, and tests.
- Prompt/request body capture is off by default and requires explicit, warned opt-in.
- Each watcher has health/dropped-count/test-delivery feedback.
- Browser logging is opt-in and privacy-preserving.
- Server logger flushes on shutdown/fatal paths where supported.
- Tests cover config validation, redaction, watcher CRUD, and at least one server and one browser transport.
- Fresh security review confirms there is no credential leakage, SSRF-style arbitrary log delivery, or unbounded log storage.

## Review workload guard

Split this roadmap into small PRs. Any PR over 400 changed lines requires chained PR planning unless a reviewer explicitly approves the larger slice.

## Verification commands

Commands are finalized per phase, but the final gate must include:

```bash
npm run build
npm run lint:fatal
npm run typecheck
npx vitest run --config tests/vitest.config.js
npx vitest run tests/translator
```

Add e2e/integration commands once current project scripts are normalized.

## STOP conditions

- Upstream sync would delete or disable fork feature surface.
- A PR requires a product decision.
- A dependency update requires a runtime behavior change outside its plan.
- TypeScript migration needs casts to pass.
- LoggerJS transport configuration would allow arbitrary unaudited outbound delivery,
  credential leakage, prompt/body capture by default, or unbounded local log storage.
- Any agent proposes `any`, explicit `unknown`, disabled tests, swallowed errors,
  or broad feature removal.
