# Repository Guidelines

## Project Structure & Module Organization

9Router combines a Next.js dashboard and routing gateway. App Router pages, API routes, shared UI, stores, and persistence live under `src/`; `src/app/api/v1/` is the public API entry layer. Provider-neutral execution, translation, and fallback logic lives in `open-sse/`. Read `open-sse/AGENTS.md` before changing that subsystem. The independently published launcher is in `cli/`, static files are in `public/` and `images/`, maintenance utilities are in `scripts/`, and Vitest suites are in `tests/unit`, `tests/auth`, and `tests/translator`. Architecture details are documented in `docs/ARCHITECTURE.md`.

## Build, Test, and Development Commands

- `npm install` installs dashboard and gateway dependencies.
- `npm run dev` starts Next.js development on port `20127`.
- `npm run build` creates the standalone production build; `npm run start` serves it.
- `npx eslint .` runs the repository's Next.js ESLint configuration.
- `npm --prefix tests install` installs the independent Vitest package.
- `npm --prefix tests test` runs all `*.test.js` files; append `-- unit/capabilities.test.js` for one file.
- `npm run cli:pack` builds and packs the CLI artifact.

Copy `.env.example` to `.env` before local runtime work. Use Node.js 18 or newer.

## Coding Style & Naming Conventions

Use plain JavaScript with ESM imports, two-space indentation, semicolons, and double quotes, matching nearby code. Prefer the `@/` alias for `src/` imports and `open-sse/` aliases for engine code. Name React components in PascalCase, functions and variables in camelCase, and route handlers as App Router `route.js` files. Reuse existing config, schemas, and helpers; do not hand-edit generated provider registry indexes.

## Testing Guidelines

Name tests `*.test.js`; reserve `*.real.test.js` for credentialed live-provider checks. Add the smallest regression test near the affected subsystem. The suite has known failures, so use the committed scripts in `tests/__baseline__/` when provider, alias, or OAuth registry behavior changes. Never commit credentials or enable live tests by default.

## Commit & Pull Request Guidelines

Follow the existing Conventional Commit pattern: `fix(session): ...`, `feat(search): ...`, or `test(translator): ...`. Keep commits focused. Pull requests should explain behavior changes, list verification commands, link relevant issues, and include screenshots for dashboard changes. Call out configuration, migration, security, or compatibility impacts explicitly.

## Engineering Operating Rules

### Objective

Complete the user's exact request with the smallest correct and verifiable change.

Optimize in this order:

1. Correctness
2. User intent
3. Preservation of existing behavior
4. Consistency with the repository
5. Small change surface
6. Architectural elegance

Do not invent requirements.

Do not optimize for hypothetical future needs.

### Default Workflow

For ordinary tasks, use this loop:

1. Locate the directly relevant code.
2. Find the closest existing implementation or pattern.
3. Read only the files needed to understand the change.
4. Make the smallest viable patch.
5. Run the narrowest relevant checks.
6. Stop.

For straightforward tasks, do not produce a long implementation plan.

Start with a narrow investigation. Expand only when concrete evidence requires it.

### Scope Gate

Every non-trivial change must satisfy at least one of these conditions:

- It is explicitly requested.
- It is required for the requested behavior to be correct.
- It is required by an existing caller, contract, test, or interface.
- It prevents a concrete and likely security, data-loss, or reliability failure.

If none apply, omit the change.

“Might be useful later” is not sufficient justification.

Do not perform bonus work.

Do not fix unrelated issues merely because you notice them. Mention an important unrelated issue briefly, but leave it unchanged.

### Minimal Change Policy

Prefer:

- editing existing code
- following the nearest existing pattern
- reusing existing functions and types
- local logic
- fewer modified files
- fewer new concepts
- no new dependencies
- no new configuration
- no public API changes
- changes that are easy to verify and revert

When choosing between a local patch and a broader design, choose the local patch unless there is concrete evidence that it cannot be correct.

A small amount of local duplication is preferable to a premature abstraction.

### Do Not Over-Engineer

Unless explicitly required, do not introduce:

- new architectural layers
- broad refactors
- generalized frameworks
- base classes
- interfaces with only one implementation
- factories
- registries
- dependency-injection systems
- plugin systems
- wrappers around already-simple APIs
- feature flags
- environment variables
- configuration options
- caching
- retry systems
- concurrency
- background jobs
- observability infrastructure
- custom error hierarchies
- compatibility layers for hypothetical callers

Do not replace working code merely because another design appears cleaner.

Do not turn a one-off requirement into a reusable subsystem.

Do not extract a helper unless it clearly simplifies the current change or isolates a meaningful current invariant.

Do not generalize based only on imagined future variants.

### Preserve Existing Design

Treat the existing repository as intentional unless there is evidence otherwise.

Before introducing a new pattern:

1. Search for a comparable implementation.
2. Reuse its structure when appropriate.
3. Follow existing naming, validation, error-handling, and testing conventions.

Preserve existing public behavior unless the task explicitly changes it.

Do not rename, reformat, reorder, or clean up unrelated code.

Do not substitute the project's package manager, libraries, or tooling with personal preferences.

### Task-Specific Behavior

#### Bug Fixes

- Identify the actual failing path.
- Fix the cause at the narrowest appropriate boundary.
- Add or update a focused regression test when practical.
- Do not combine the fix with unrelated cleanup.
- Do not redesign the surrounding subsystem.

#### Features

- Implement exactly the requested behavior.
- Support the stated use case, not every conceivable future variant.
- Reuse existing extension points before creating new ones.
- Do not create a framework for a single feature.

#### Refactors

- Refactor only when explicitly requested or when the requested change cannot be implemented safely without it.
- Keep the refactor limited to the required area.
- Preserve observable behavior unless instructed otherwise.
- Do not mix broad cleanup into feature work.

#### Investigation and Review

- Do not modify code unless the user asks for changes.
- Separate confirmed findings from speculation.
- Prefer evidence from code, tests, logs, and existing behavior.

### Edge Cases

Handle edge cases that are:

- explicitly mentioned
- common in normal usage
- demonstrated by existing code or tests
- necessary for correctness
- capable of causing security issues, data loss, or serious reliability failures

Do not add substantial complexity for theoretical or extremely unlikely scenarios.

Do not attempt to support every malformed input combination unless the component is specifically responsible for untrusted-input validation.

### Error Handling

Follow the repository's existing error-handling style.

Prefer a clear direct failure over an elaborate fallback chain.

Do not add retries, recovery flows, fallback providers, or custom exception taxonomies unless the current task requires them.

Do not silently swallow errors.

### Dependencies and Interfaces

Do not add a dependency when the task can reasonably be solved with:

- the standard library
- existing project dependencies
- a small amount of local code

Do not change public APIs, schemas, storage formats, configuration formats, or deployment behavior unless requested or required for correctness.

Preserve compatibility for real existing callers.

Do not add compatibility behavior for hypothetical consumers.

### Testing

Run the narrowest relevant validation first:

- focused tests
- targeted type checking
- targeted linting
- the affected build step

Add or update tests when behavior changes and the repository already has an appropriate testing pattern.

Do not create new test infrastructure for a trivial patch.

Do not rewrite unrelated tests.

Do not weaken existing assertions merely to make tests pass.

Run broader checks only when the change surface or risk justifies them.

If a relevant check cannot be run, state the exact reason.

### Ambiguity

When minor ambiguity remains, choose the conservative and reversible interpretation that changes less.

Do not silently broaden the task.

Ask for clarification only when different interpretations would produce materially different user-visible behavior, destructive actions, or incompatible APIs.

Do not ask questions that can be answered from the repository.

### Decision Rule

When multiple implementations are correct, prefer the one that:

1. best matches the exact request
2. follows an existing repository pattern
3. introduces the least new state and complexity
4. modifies the smallest surface
5. is easiest to test
6. is easiest to revert

Generality and theoretical elegance come last.

## Fork Release Memory

This fork is maintained at `github.com/vutranHS/9router`. Preserve these shipped behaviors in future changes:

### v0.5.60 — API-Key Authorization and Fair Use

- API keys can optionally whitelist multiple provider accounts and the chat or image-generation models allowed on each account. An unconfigured key remains unrestricted for backward compatibility.
- `/v1/models` only exposes models authorized for that key, and requests for other accounts, models, image generation, or a disabled Vision Adapter are rejected.
- Vision fallback is a per-key capability toggle and uses the globally configured Vision Adapter; adapter usage is not charged to the key quota.
- Each key can receive a percentage limit per account. Enforcement uses only the account's shortest current Codex or Claude quota window, combines chat and image usage, falls back to another authorized account when possible, and otherwise returns `429`.
- Quota cost is estimated from learned provider deltas by model/reasoning effort and image size/quality. It is an estimate, not token-accurate billing.
- Tag pushes build an installable CLI `.tgz` through `.github/workflows/release-cli.yml`.

### v0.5.61 — Live Account Models

- The API-key permissions UI merges live Claude and Codex model catalogs from every selected account instead of relying only on the static registry.
- Claude discovery uses OAuth Bearer authentication, refreshes expired tokens, and follows model-list pagination.

### v0.5.62 — Bare Harness Model Routing

- Bare `gpt-*` names default to the `codex` provider and bare `claude-*` names default to the `claude` provider. Explicit `provider/model` names and user aliases still take precedence.

### Communication

For straightforward work, act instead of narrating every step.

Keep progress updates concise and relevant.

The final response should normally contain only:

- what changed
- what was verified
- any concrete unresolved limitation

Do not include an architecture essay, a long retrospective, or a list of optional future improvements unless requested.

### Interpretation Examples

- “Fix this validation bug” does not mean rewrite the validation layer.
- “Add this field” does not mean build a schema framework.
- “Support provider X” does not mean create a provider plugin system.
- “Improve this error message” does not mean introduce a custom error taxonomy.
- “Make this function work for case Y” does not mean redesign all callers.

### Stop Condition

Stop when:

- the requested behavior is implemented
- relevant checks pass
- the patch does not introduce a known regression

Do not continue improving nearby code after the task is complete.
