# FED-GAP-07 — API-key create-then-authenticate over HTTP, with the real guard (2026-09-18)

Successor of row **C4** in `docs/dogfood/2026-09-18-federation-value-claims.md`
("API-key round-trip worked", verdict `PARTIAL`). That row rested on two halves that could
not meet: a repository-level CRUD test and an HTTP-guard test whose validator was a
hand-written module stand-in. The documented flow — `docs/api-reference.md`, Authentication:
login → `POST /api/keys` → present the key on `/v1` — was therefore asserted **nowhere** end
to end.

This artifact records what is asserted now, by which check, the red-proofs that show the
check is load-bearing, and what remains unproven.

## 1. What the gap was

| Missing half | Why it mattered |
|---|---|
| The real `POST /api/keys` route | `tests/unit/db-sqlite-vs-lowdb.test.js:50` calls `createApiKey()` directly, so the tracked route `src/app/api/keys/route.js` (status `201`, response key set, `400` on a missing name) had no test; `tests/federation/e2e-child.mjs` *emulates* `POST /api/keys` by diffing `getApiKeys()` around `applyReplayMutation(...)` and answering with the route's shape — the module is never invoked. |
| The guard against a key that really exists | `tests/unit/dashboard-guard.test.js` replaces the `localDb` barrel with a fixture module, so its `validateApiKey` is a `vi.fn()`; "remote request with a valid key passes" was proven against a stub that never touches a database. |
| The chain | Nothing posted to the real keys route and then presented the returned key to the real guard. |

## 2. What is asserted now

`tests/federation/api-key-http-auth-chain.test.js` (10 tests, ~0.5 s, no network). One
temp-`DATA_DIR` SQLite database, three real modules, zero module stand-ins:

| Module | Role in the chain |
|---|---|
| `src/app/api/keys/route.js` | `POST` — creates the key through the real request handler (plain web `Request` in, `NextResponse` out). |
| `src/lib/db/repos/apiKeysRepo.js` | the row-level cross-check: the created `id` is a real ACTIVE row (`getApiKeys()`), and the key is the stored value. |
| `src/dashboardGuard.js` | `proxy()` — the real gate for `/v1/*`, resolving the credential through the real `validateApiKey` (SQL read) with no injection point. |

### 2.1 The route

* `201` with exactly the keys `id`, `key`, `machineId`, `name`; `name` echoes the request;
  `key` matches `/^sk-/`; `machineId` is the server-derived 16-hex `getConsistentMachineId()`
  value (never taken from the body).
* The returned `id` is present in `getApiKeys()` with `isActive === true` and `key` equal to
  the response's `key`.
* A missing `name` → `400 {"error":"Name is required"}` and **no** row added.

### 2.2 The guard

Both guard requests are built as a **remote** peer on purpose: `x-9r-real-ip: 203.0.113.7`
with the per-process peer proof (`x-9r-peer-token` = the value in `NINEROUTER_PEER_TOKEN`)
and no CLI token — so `isLocalRequest()` is false and the guard cannot short-circuit past
the key check. The premise test asserts exactly that (`__test__.isLocalRequest(...) === false`)
and that the fresh database's effective `settings.requireApiKey === true`.

* **Positive** — `GET /v1/models` with `Authorization: Bearer <the key the real route just
  returned>` passes `proxy()`. Pass-through is asserted on the real object as
  `status === 200` **and** `x-middleware-next === "1"` (the whole header set of
  `NextResponse.next()` as this Next version emits it). The same key also passes on a second
  public prefix, `/v1/chat/completions`. Nothing dispatches upstream — `proxy()` only gates.
* **Negative control A** — the same request with no credential → `401`, body
  `{"error":"API key required for remote API access"}` (the guard's own text).
* **Negative control B** — a syntactically plausible neighbour of the real key (its last
  character flipped; never the federation token, never a live credential) → the same `401`
  and the same body.
* **Negative control C (load-bearing)** — `updateApiKey(id, {isActive: false})` and the
  previously accepted request now returns the same `401`; the same key reactivated returns
  the pass-through again. Same request, same headers, one database column changed — so the
  positive case cannot be a phantom of file ordering or a guard that ignores the database.

### 2.3 The file's own premise

Because the entire value of the file rests on provenance, the last test reads
`api-key-http-auth-chain.test.js`'s own source and fails if it ever gains a module stand-in
(a `vi.mock(...)` call) or imports the `localDb` barrel instead of the repository. The
needles are assembled from fragments so they cannot match the assertion's own text. This
check is itself red-proven in §3.

## 3. Red-proofs (the check was made to fail, then restored)

| Mutation | Expected | Observed |
|---|---|---|
| scratch copy of the test with the fixture peer set to loopback (`x-9r-real-ip: 127.0.0.1`) — i.e. the guard short-circuits as a local request and never consults the database | the controls fail | **4 failed / 6 passed**: premise + negative controls A, B and C. Proves the controls, not the pass-through, are what make the chain meaningful. |
| scratch copy with the validator's module replaced by a pass-through of the *real* repository module (`vi.mock` + `importActual`) — behaviour identical, provenance no longer the app module | the chain tests stay green, the realness guard fails | **1 failed / 9 passed** — only the realness guard, `expected true to be false`. Proves that assertion is not vacuous and that a mocked-validator file (the C4 defect) cannot pass it. |
| the real `src/dashboardGuard.js` weakened: `canAccessPublicLlmApi`'s `return await hasValidApiKey(request)` → `return true` | the controls fail | **3 failed / 7 passed**: negative controls A, B and C (the positive case and the route tests stay green — the bypass only removes denial). Restored, `git diff` on the file empty. |

## 4. Exact reproduction (no network, no credentials, no `RUN_REAL`)

```bash
cd /home/kara/9router

# focused — the whole chain, in-process
cd tests && ./node_modules/.bin/vitest run federation/api-key-http-auth-chain.test.js && cd ..
# → Test Files 1 passed (1) · Tests 10 passed (10) · ~0.5s

# repository regression gate (full suite, ~10-20 min)
cd tests && npx vitest run --reporter=json --outputFile=/tmp/9r390-full.json && cd ..
node tests/__baseline__/verify-no-regression.mjs /tmp/9r390-full.json
# → ✅ No regression. (now fails=84, baseline known=84, all known)
```

Full-suite JSON at this revision (`/tmp/9r390-full.json`, jest format):

| key | value |
|---|---|
| `numTotalTests` | 2822 |
| `numPassedTests` | 2677 |
| `numFailedTests` | 84 |
| `numPendingTests` | 61 |
| `numFailedTestSuites` | 60 |

The 84 failures are the repository's catalogued baseline
(`tests/__baseline__/known-fails.txt`), and the gate's verdict is verbatim
`✅ No regression. (now fails=84, baseline known=84, all known)`. The new file's own
suite entry in that same JSON is `tests/federation/api-key-http-auth-chain.test.js`
→ `passed`, 10 assertion results, all `passed`.

Observed focused run of the new file (this revision):

```
Test Files  1 passed (1)
     Tests  10 passed (10)
  Duration  501ms
```

Negative-control bodies observed verbatim (from the probe run, 2026-09-18):

```
no key      → 401 {"error":"API key required for remote API access"}
bogus key   → 401 {"error":"API key required for remote API access"}
deactivated → 401 {"error":"API key required for remote API access"}
positive    → 200, headers: [["x-middleware-next","1"]]
```

## 5. Honest limits (not claimed)

1. **Next's router is not in the loop.** The two modules are imported and called directly
   (real `Request`/`NextRequest` in, real `NextResponse` out). Their logic and wiring are the
   app's; `next build` + `custom-server.js` routing around them is not exercised here (that
   is the packaged-boot row, FED-GAP-05, and the federation E2E).
2. **In-process, not over a socket.** No HTTP listener is started: no `HTTP/1.1` hop, no
   header serialisation, no proxy epoch. The guard's decisions are asserted on real framework
   objects, but a wire-level round trip is not.
3. **Only the `x-9r-real-ip` peer shape.** `extractApiKey()`'s other credential carriers
   (`x-api-key`, `x-goog-api-key`, `?key=`), the CLI-token branch and the
   `requireApiKey === false` deployment opt-out are exercised only in the "not taken" role —
   they are not asserted here.
4. **Only two `/v1` paths** (`/v1/models`, `/v1/chat/completions`); other public prefixes
   (`/v1beta`, `/codex`, `/responses`) share the gate but are not asserted.
5. **The created key's `machineId` comes from the host** (`node-machine-id` / `/etc/machine-id`,
   falling back to a random UUID) and is written into the temp `DATA_DIR`; no network and no
   write outside the temp directory, but the value is host-derived, not fixed.
6. **No `/api/auth/login` coverage** — that is matrix row C3 and was deliberately left
   untouched.

## 6. Adjacent observation (NOT part of this task's acceptance)

While building negative control C the `deleteApiKey(id)` variant was probed instead of the
deactivate variant. It does **not** revoke the key:

```
create (route)            → 201, key sk-…
deleteApiKey(id)          → true;  getApiKeys() no longer lists it; getApiKeyById(id) → null
validateApiKey(key)       → true    (still)
remote GET /v1/models     → 200, x-middleware-next: 1   ← the deleted key still authenticates
```

`apiKeysRepo.validateApiKey()` is the only read path in the repository that omits the
`NOT_DELETED` predicate every sibling (`getApiKeys`, `getApiKeyById`) applies
(`src/lib/db/repos/apiKeysRepo.js:76`). Consequence: `DELETE /api/keys/{id}` (the dashboard's
"remove key", `src/app/api/keys/[id]/route.js:64`) tombstones the row but leaves the
credential working on `/v1`. This is **out of scope for FED-GAP-07** (the brief fixes the
chain, not the revocation semantics) and no source file was changed for it — but it is a
live, reproducible behaviour, so it is recorded here with the repro instead of being dropped.
The chain test therefore uses the **deactivate** variant for negative control C, which is
honest (it does revoke) and does not encode the delete defect as expected behaviour.

Repro: the probe is a 40-line scratch vitest file that imports the same three real modules,
creates a key through the route, calls `deleteApiKey(id)`, then re-drives `proxy()` with the
key. Recommended follow-up: a board row on `9router` to add the `NOT_DELETED` predicate to
`validateApiKey` plus a regression test at this same level (route create → `DELETE`
route → `/v1` must 401).
