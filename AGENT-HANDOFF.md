# Handoff: the Docker/Kubernetes deployment of the Claude Code CLI provider

What this fork adds to a deployment, what has actually been verified, and what
has not. Written for whoever picks this up next, including me.

## What this deployment is

One provider that upstream does not have:

**Claude Code CLI (`claude-cli`)** routes through the `claude` binary running in
the router's own container — no API key, and no OAuth token replayed by this
server. One account is one Claude Code identity. On a desktop that is a config
directory; in a container it is a token from `claude setup-token`, which is the
only kind that works there because the interactive login needs a terminal.
Several accounts work side by side with per-account fallback, and each can carry
a cron keepalive that runs `claude -p` as that account.

The router image bundles Claude Code, so nothing extra has to be installed.

### There is no ChatGPT Web provider

There was one. It was removed after it turned out not to work as a routed
provider at all — see FORK-CHANGELOG.md for the full reasoning. The short
version: the codex-chatgpt-web bridge requires the Codex CLI's own turn metadata
on every request and deliberately refuses to accept environment context from a
raw Responses request, so a proxy in front of it cannot satisfy it. All 47
published bridge tags behave this way.

**Do not re-add it by pinning an older bridge.** That was checked; there is no
such version.

## Adding an account

Entirely in the dashboard — no kubectl, no console:

1. On a machine that has Claude Code, run `claude setup-token`.
2. Dashboard → Providers → Claude Code CLI → paste it under "Add an account with
   a token".
3. Press Check. It reports the account's email and plan when Claude accepted the
   token, and says the token was refused when it did not.

The card is reachable in a container because the loopback restriction on these
routes is lifted when 9Router detects `/.dockerenv` or
`KUBERNETES_SERVICE_HOST`. Dashboard authentication still applies — that is what
`scripts/fork/check-container-guard.mjs` covers.

## Verified, and how

Run these from the repo root. The ones that drive a server take a few minutes
each and need their port free.

| check | what it proves |
|---|---|
| `node scripts/fork/verify-fork.mjs` | every fork file is present, the registry loads, the fork's own tests pass |
| `node scripts/fork/check-claude-accounts.mjs` | the accounts route against a real Next server: add a token account, Check it, schedule a keepalive, and confirm it reaches the quota tracker (27/27) |
| `node scripts/fork/check-container-guard.mjs` | the container relaxation does not become an open door |
| `node scripts/fork/check-quota-view.mjs` | the quota tracker in real Chromium, both views (12/12) — needs a production build and `playwright-core` |
| `node scripts/fork/check-k8s-manifests.mjs <dir>` | the Kubernetes bundle parses and keeps its constraints (21/21) |

Against upstream v0.5.85 the full suite runs 2952 tests with the same failure
set as upstream itself — judge regressions that way, not by a raw count.

`check-quota-view.mjs` runs `next start`, not `next dev`, on purpose:
`custom-server.js` rejects the dev HMR upgrade, so under `next dev` the client
never hydrates and every control on the page is inert. A UI check written
against `next dev` measures nothing.

## Bringing it up after a code change

```bash
TAG=0.5.85-<sha>
H=harbor.thisisserver.com/library
docker build -t $H/9router:$TAG .
docker push $H/9router:$TAG
# then bump the router tag in deployment.yaml and let ArgoCD sync
```

Jenkins does the build and push (`Jenkinsfile`, via the shared library's
`buildAndDeployApp`, `deployToK8s: false`); the tag in Kubernetes-Application is
changed by hand. Its tags are `<YYYYMMDD>_<build>`, so nothing in the tag says which
Claude Code is inside — that is the Dockerfile's `ARG CLAUDE_CODE_VERSION`.
The library cannot pass build-args, so moving the CLI means editing that default.

If the build dies with `heap out of memory` or `Killed`, the builder's heap is
the problem, not the code: add `--build-arg NODE_BUILD_HEAP_MB=8192`, and make
sure the host actually has that much free.

## Kubernetes constraints that must not be undone

`strategy: Recreate` with `replicas: 1` is **required**, not a preference. Every
volume in the bundle is ReadWriteMany (NFS), so Kubernetes will mount the same
one into two pods at once — a RollingUpdate does not stall here, it overlaps.
Two processes writing `/app/data/db/data.sqlite` over NFS corrupts it: SQLite's
locking needs POSIX advisory locks that NFS does not reliably provide, and the
pure-JS `sql.js` fallback rewrites the whole file, so the second pod would
silently discard the first pod's writes.

The cost is a short gap on each deploy. The `startupProbe` keeps it as small as
it can be without giving up single-writer state; it replaced a fixed
`initialDelaySeconds` that was waited out even when the server was already
listening.

`check-k8s-manifests.mjs` fails if either is reverted.

## Prompt-cache sessions (`CLI_CLAUDE_SESSION_CACHE`)

Off by default. When on, conversations are written by Claude Code into
`$CLAUDE_CONFIG_DIR/projects/` — here the RWX config volume — for the session
TTL (15 minutes, `CLI_CLAUDE_SESSION_TTL_MS`) and then deleted; plan volume
space accordingly. The registry of which conversation continues which session
is process memory, so it assumes one router process per config volume. The
`Recreate` rollout above already guarantees that; two replicas would not break
anything, only miss more.

What it cannot fix: a turn that ended in a tool call is never resumed (the CLI
closes the call in its transcript with a denial, so the client's result would
be dropped), which means tool-heavy agent loops gain little; the prompt cache
itself lasts five minutes, so a client
that pauses longer between turns misses whatever this does; a client that puts
the time (or anything else per-request) into its system prompt misses every
turn, and the log says `session: system-changed`; and a Claude Code update can
change how the CLI places its breakpoint, which would show as
`cache-miss-on-resume` lines and a falling "Prompt cache" share on the quota
card. The image pins the CLI version; a desktop host does not.

## API Key Usage page

`Dashboard → API Key Usage` (`/dashboard/api-key-usage`) is a per-API-key
breakdown that used to be three clicks into the general Usage page: a stacked
bar chart of tokens per key over a period, plus the same key x model table
Usage already had, now with a CSV export. Nothing here is provider- or
deployment-specific — it reads the same `usageHistory`/`usageDaily` tables
every other usage view reads.

- **Neither table is pruned.** `usageHistory` (one row per request) and
  `usageDaily` (one JSON blob per day) have no retention policy, no
  `DELETE`, no row cap — confirmed by grep, not assumed. They grow for as
  long as the install runs. `usageHistory` has an in-memory `RING_CAP` (50)
  for the "Recent Requests" widget and a `LIMIT 50` on one read query, but
  neither trims the table itself. This page didn't create that shape — every
  other usage view already reads the same unbounded tables — but it's worth
  saying plainly here since this page is the reason someone will eventually
  go looking for a retention policy that doesn't exist.
- **A deleted API key is identified by a hash, not by its masked prefix.**
  Every 9Router key is `sk-${machineId}-${keyId}-${crc}`
  (`generateApiKeyWithMachine`, `shared/utils/apiKey.js`); `machineId` is
  constant per install, so `maskApiKey`'s first-8-characters form is
  identical for every key on that machine. A deleted key (no row left in the
  API-keys table to join against) instead gets an 8-hex-char prefix of
  `sha256(rawKey)` — distinct per key, stable across calls, reveals nothing
  about the raw key. This is `apiKeyBucketId`'s fallback in
  `src/lib/db/repos/apiKeyUsageRepo.js`, and it is the *only* thing keeping
  two different deleted keys from rendering as one merged row in both the
  table and the chart.
- **One identity function, three call sites — but the table doesn't use it.**
  `apiKeyBucketId` is imported by `usageRepo.js` (the table's `byApiKey`) and
  used directly by `apiKeyUsageRepo.js`'s own `getApiKeyUsageSeries` (the
  chart) — both keyed the same way. The table (`page.js:124`) then groups by
  `keyName`, not by that bucket id, and `createApiKey`
  (`src/lib/db/repos/apiKeysRepo.js:28-47`) enforces no name uniqueness — no
  check, no unique index. So two keys that happen to share a name already
  render inconsistently today, not just after some future edit: the chart
  draws two segments in two colours with two legend entries; the table merges
  both into one summed row; the CSV export has two rows with identical
  key/model/provider triples and different numbers, with no column to tell
  them apart. This is pre-existing grouping behavior shared with the Usage
  page and is not fixed here. `maskApiKey` itself is duplicated, not
  imported, in `apiKeyUsageRepo.js`: that file already imports the other way,
  so pulling `maskApiKey` back out of `usageRepo.js` would close a module
  cycle. See that file's docblocks before "fixing" either of these.
- **The raw API key never became the response's re-keying problem for this
  page specifically** — that was an existing bug in `usageRepo.js` shared by
  the general Usage page too; see FORK-CHANGELOG.md's Fixes entry. This page
  just also depends on the fix, since its chart uses the same
  `apiKeyBucketId` identity.

**Not built, not rendered.** No jsdom or component-test infrastructure exists
in this repo, and a `next build`/server start was off-limits for this task.
The data layer (`apiKeyUsageRepo.js`, the route, the re-keying in
`usageRepo.js`) is covered by tests; the page (`page.js`) and the chart
(`ApiKeyUsageChart.js`) are verified only by reading — the props passed to
`UsageTable` (`renderSummaryCells`, `renderDetailCells`, `storageKey`,
`emptyMessage`) and to the chart (`series`, `keys`, `loading`) were checked
against their definitions, not against a rendered page. Do not mistake this
for verified UI.

## Not verified

- **No image has been built from this tree on the machine that wrote it.** The
  production `next build` completes, but `docker build` has not been run here.
- **No cluster has been reached.** The Kubernetes bundle is checked statically.
- **The API Key Usage page and its chart have never been rendered, built, or
  put in front of a browser** — unlike the items above, there is no partial
  verification here at all (no jsdom, no component tests, no server start).
  See "API Key Usage page" above for exactly what was and wasn't checked.
