# OpenCode Go Session Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send a stable, conversation-scoped `x-opencode-session` header on every OpenCode Go request and install the patched CLI locally.

**Architecture:** Add a dedicated `OpenCodeGoExecutor` extending `DefaultExecutor`. `chatCore` passes the provider-scoped session resolved from the original request plus the detected client tool; the executor derives a request-local upstream session and delegates all existing transport, authentication, retry, and proxy behavior to `DefaultExecutor`.

**Tech Stack:** Node.js ESM, Vitest, Next.js, npm CLI packaging, GitHub CLI.

## Global Constraints

- Apply the header to OpenCode Go chat completions, Claude Messages, and OpenAI Responses transports.
- Preserve a valid native `x-opencode-session`; hash all translated non-OpenCode identities to `ses_<32 lowercase hex>`.
- Namespace translated identities by detected client tool, using `generic` when unknown.
- Do not keep mutable per-request session state on the executor singleton or mutate the caller's credentials object.
- Do not change OpenCode Go models, routing, reasoning, tool behavior, dependencies, or unrelated providers.
- Reuse upstream issue #3759 instead of creating a duplicate issue.

---

### Task 1: Add Failing OpenCode Go Session Tests

**Files:**
- Create: `tests/unit/opencode-go-session.test.js`

**Interfaces:**
- Consumes: `getExecutor(provider)` and `DefaultExecutor.buildHeaders(credentials, stream, url, model)`.
- Produces: the required public behavior for `OpenCodeGoExecutor.prepareRequestCredentials({ body, credentials, providerSessionId, clientTool })` and `OpenCodeGoExecutor.execute(args)`.

- [ ] **Step 1: Write the failing tests**

Create a Vitest suite that mocks `proxyAwareFetch`, obtains `getExecutor("opencode-go")`, and asserts:

```js
const prepared = executor.prepareRequestCredentials({
  body: { messages: [{ role: "user", content: "hello" }] },
  credentials: { apiKey: "test-key", connectionId: "conn-a", rawHeaders: {} },
  providerSessionId: "conversation-a",
  clientTool: "claude",
});

expect(prepared).not.toBe(credentials);
expect(prepared._opencodeGoSession).toMatch(/^ses_[0-9a-f]{32}$/);
expect(credentials).not.toHaveProperty("_opencodeGoSession");
```

Cover native header preservation, stable values across all three runtime transports, different conversation IDs, different client tools using the same ID, connection fallback, no singleton state, no header on `DefaultExecutor("openai")`, and the final fetch headers returned by `execute()`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run --config tests/vitest.config.js tests/unit/opencode-go-session.test.js
```

Expected: FAIL because `getExecutor("opencode-go")` still returns `DefaultExecutor` and `prepareRequestCredentials` does not exist.

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/unit/opencode-go-session.test.js
git commit -m "test: cover OpenCode Go session headers"
```

### Task 2: Implement the Dedicated Executor

**Files:**
- Create: `open-sse/executors/opencode-go.js`
- Modify: `open-sse/executors/index.js`

**Interfaces:**
- Consumes: `DefaultExecutor`, `resolveSessionId()`, request `credentials.rawHeaders`, `providerSessionId`, and `clientTool`.
- Produces: `OpenCodeGoExecutor`, `prepareRequestCredentials()`, and an `execute()` override that delegates with cloned credentials.

- [ ] **Step 1: Add the minimal executor implementation**

Implement these rules:

```js
function translatedSessionId(sessionId, clientTool) {
  const digest = crypto
    .createHash("sha256")
    .update(`opencode-go\0${clientTool || "generic"}\0${sessionId}`)
    .digest("hex")
    .slice(0, 32);
  return `ses_${digest}`;
}
```

`prepareRequestCredentials()` must read a case-insensitive native
`x-opencode-session` with the same non-empty, 256-character cap used by the
session manager. Otherwise it uses `providerSessionId` or calls
`resolveSessionId({ headers, body, connectionId, scope: "opencode-go" })`, then
returns `{ ...credentials, _opencodeGoSession: value }`.

`execute(args)` must call `prepareRequestCredentials(args)` and delegate using
`super.execute({ ...args, credentials: prepared })`. `buildHeaders()` must call
`super.buildHeaders()` and add the prepared session, with a connection-scoped
fallback for direct callers.

Register `new OpenCodeGoExecutor()` under `"opencode-go"` and export the class.

- [ ] **Step 2: Run the focused test and verify partial GREEN**

Run:

```bash
npx vitest run --config tests/vitest.config.js tests/unit/opencode-go-session.test.js
```

Expected: executor-level tests pass; any chatCore-context assertion remains failing until Task 3.

- [ ] **Step 3: Commit the executor**

```bash
git add open-sse/executors/opencode-go.js open-sse/executors/index.js tests/unit/opencode-go-session.test.js
git commit -m "fix(opencode-go): add stable session header executor"
```

### Task 3: Pass Original Request Session Context

**Files:**
- Modify: `open-sse/handlers/chatCore.js`
- Modify: `tests/unit/opencode-go-session.test.js`

**Interfaces:**
- Consumes: existing `sessionSeed` and `clientTool` variables in `handleChatCore()`.
- Produces: `providerSessionId` and `clientTool` fields on both initial and refreshed-credential calls to `executor.execute()`.

- [ ] **Step 1: Add or enable the failing integration assertion**

Use a mocked executor or source request containing a body-only `session_id` and
assert the executor receives the provider-scoped session resolved before
translation.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run --config tests/vitest.config.js tests/unit/opencode-go-session.test.js
```

Expected: FAIL because `handleChatCore()` does not pass `providerSessionId` or
`clientTool` to `executor.execute()`.

- [ ] **Step 3: Pass the request context**

Add the same fields to both executor calls:

```js
executor.execute({
  model,
  body: translatedBody,
  stream,
  credentials,
  providerSessionId: sessionSeed,
  clientTool,
  signal: streamController.signal,
  log,
  proxyOptions,
});
```

- [ ] **Step 4: Run focused and neighboring tests**

Run:

```bash
npx vitest run --config tests/vitest.config.js \
  tests/unit/opencode-go-session.test.js \
  tests/unit/opencode-go-models.test.js \
  tests/unit/session-manager.test.js \
  tests/unit/executor-const-guard.test.js
```

Expected: PASS with zero failed tests.

- [ ] **Step 5: Commit the context wiring**

```bash
git add open-sse/handlers/chatCore.js tests/unit/opencode-go-session.test.js
git commit -m "fix(chat): forward provider session context"
```

### Task 4: Verify and Install the Local CLI Package

**Files:**
- Generated: `9router-0.5.65.tgz`
- Packaged output: `cli/app/server.js`

**Interfaces:**
- Consumes: completed source changes and existing CLI build scripts.
- Produces: a globally installed patched `9router@0.5.65`.

- [ ] **Step 1: Run source verification**

```bash
git diff --check origin/master...HEAD
npx vitest run --config tests/vitest.config.js tests/unit/
npm run build
```

Expected: every command exits zero. Record any pre-existing full-suite failures
separately rather than hiding them.

- [ ] **Step 2: Build and package the CLI**

```bash
npm --prefix cli run build
npm --prefix cli pack -- --pack-destination ..
```

Expected: `9router-0.5.65.tgz` exists and contains the patched bundled server.

- [ ] **Step 3: Replace the global npm installation**

```bash
npm install -g ./9router-0.5.65.tgz
```

Expected: `/opt/homebrew/lib/node_modules/9router/package.json` reports `0.5.65`
and the installed bundle contains `x-opencode-session` plus the new executor.

- [ ] **Step 4: Commit any required package-source adjustment**

Do not commit generated tarballs or CLI build artifacts unless the repository
already tracks and requires them.

### Task 5: Publish the Upstream Pull Request

**Files:**
- No additional source files unless verification finds a required correction.

**Interfaces:**
- Consumes: verified branch commits and GitHub issue #3759.
- Produces: a fork branch and a PR against `decolua/9router:master`.

- [ ] **Step 1: Create or repair the GitHub fork remote**

Use `gh repo fork decolua/9router --remote` if the current `fork` remote remains
missing, then push `fix/opencode-go-session-header`.

- [ ] **Step 2: Create the PR**

Use title:

```text
fix(opencode-go): send stable session header
```

The body must include the root cause, downstream-session translation policy,
three covered transports, concurrency behavior, verification evidence,
`Fixes #3759`, and a note that this PR is intentionally narrower than #3780.

- [ ] **Step 3: Verify the published PR**

Run `gh pr view --json number,title,state,url,headRefName,baseRefName` and report
the issue and PR URLs.
