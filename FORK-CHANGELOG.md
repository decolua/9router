# Fork changelog

Changes carried by this fork on top of upstream `decolua/9router`.

Kept out of the upstream `CHANGELOG.md` on purpose: upstream rewrites the top of
that file on every release, so an entry there would conflict on 100% of upgrades.
See [UPGRADE.md](UPGRADE.md) for how the fork is carried forward.

## Unreleased (on top of v0.5.112)

### Features

#### Claude Code CLI 2.1.301, and a Jenkins job

The image's `CLAUDE_CODE_VERSION` moves from 2.1.281 to 2.1.301 (npm `latest`; the
`stable` tag is 2.1.292). `Jenkinsfile` builds and pushes through the shared
library with `deployToK8s: false`; the Kubernetes-Application tag stays manual.
Not changed: `CLAUDE_CLI_VERSION` in `open-sse/providers/shared.js` (the plain
`claude` provider's user-agent) is still 2.1.281, and the `claude-cli` code cites
behaviour measured on 2.1.281 — neither re-checked against 2.1.301, except
`--json-schema` and the rate-limit events (see Fixes), which were read from, and run
against, the 2.1.301 binary (the rate-limit schema is the same as on 2.1.295).

### Fixes

#### The image's lazy runtime deps are held to their package.json ranges

v0.5.112's Dockerfile installs `wreq-js` and `playwright-core` into the runner by bare
name, i.e. whatever is `latest` on the day Jenkins builds — a new major would land
unreviewed, against code written for `^3.2.0` / `^1.62.1`. The install now names those
ranges, the same ones `package.json` and `LAZY_DEP_VERSIONS` use.

#### The claude-cli tests pass on Linux and against an org-managed account

`buildSpawnPlan(bin, args, platform)` takes the platform the way `isShimPath` already
did, so the two `.cmd`-shim tests exercise the Windows path on any host instead of
failing everywhere but Windows (production callers still pass two arguments). In the
live suite (`REAL_CLI_TESTS=1`): the oversized system prompt was 31,822 characters, under
the 32,767 limit its own premise checks, so it now has 150 sections (~40k); the
concurrency-slot test waits for an earlier test's child to release its slot before
counting; and the token-precedence test also accepts the refusal an org that enforces
remote managed settings gives a bogus token — it is still the token, not the config
directory, being used.

#### A failure inside an HTTP 200 now falls through to the next model

kimchi answers a model whose provider has no credits left with
`{"error": "the provider for model … has exhausted its credits…"}` — as a plain 402,
which already fell back, but also as the body (or first SSE frame) of a **200**. The
status was 200, so nothing downstream saw a failure: the error text reached the client
as the reply, account fallback and the combo never moved on, and an agent client (Hermes)
simply stopped.

`open-sse/utils/upstreamBodyError.js` reads such a failure out of the body — a bare
`{error}` JSON, an error as the first SSE frame, `event: error`, or a bare JSON error
behind an SSE content-type — and gives it the status it stands for (a status in the body
wins; credits gone → 402, rate/capacity → 429, bad key → 401, else 502), so the ordinary
error path takes over. Non-streaming: `nonStreamingHandler.js`; streaming:
`guardStreamHead()` in `chatCore.js` reads the head of the stream before anything is sent
and replays it untouched when it is healthy. It holds the stream for a short window after
its first frame (`STREAM_ERROR_HOLD_MS`, default 500 ms, `0` = decide on the first frame;
released early at 4 KB), so an error arriving right behind the first content still fails
over — nothing has reached the client yet. The price is up to that much first-token
latency on every stream. The forced-SSE→JSON path classifies the same way (it used to drop
a bare-string error's text).

Not fixed, and cannot be: an error that arrives *after* the window, once content is on its
way to the client. Taking it back and re-asking another model would hand the client two
answers glued together (continuing from the partial answer would be the alternative; not
built). Such an error now goes out as a standard `{error:{message,type,code}}` frame — a
bare-string `{"error":"…"}` used to be passed through as it came, unreadable to OpenAI
clients. Also fixed in passing: every passthrough stream ended in **two** `data: [DONE]`
(the upstream's was forwarded without noting it, and `flush()` added another).
Fail-open throughout: anything that is not clearly an error is passed on as it was.

#### Fork cron keepalive and upstream's anchored schedules coexist (v0.5.104)

v0.5.104 added its own wall-clock auto-ping: `settings.<provider>AutoPing.schedules`,
`quotaPingSchedule.js`, a schedule modal. It overlaps the fork's cron keepalive but
uses a different setting key, so both are kept, per account, in one tick
(`quotaAutoPing.js`): `cron` runs for any handler; `schedules` and the reset-based
ping only for a handler with a usage endpoint (`pingConnection` reads usage, which the
claude-cli handler has none of). The scheduler stays on if either is configured
(`hasAnyAutoPingEnabled`, `initializeApp`). Worth deciding later whether to retire the
fork's cron in favour of upstream's schedules, which would remove a conflict surface.

#### A Claude Code CLI provider that is switched off is skipped in a combo

A no-auth provider has no credential to be missing, so `getProviderCredentials`
stood in a synthetic "Public" connection whenever it found no *active* connection.
claude-cli's accounts are real rows, so switching every one of them off left zero
active rows, which read as "no accounts at all" — and the stand-in answered, so a
combo kept sending to a provider the operator had turned off while every other
provider was skipped. The stand-in is now used only when the provider has no
connection rows at all; rows that are all off mean the provider is off (no
credentials, so the combo moves on). An account added but not yet logged in
(inactive, `testStatus: pending`) was never switched on and does not count as off.

#### An account that is out of quota is not asked again, and the combo moves on

The CLI reports a spent subscription as ordinary content ("You've hit your limit"),
so the router saw a 200 and kept sending to it — and, at best, a 502 that locked the
model for 30 seconds before the next attempt. The CLI does say so in a form that can
be read (from the 2.1.295 binary, unchanged on 2.1.301): a `rate_limit_event` whose `rate_limit_info.status`
is `rejected` (with `resetsAt` and the `rateLimitType` of the window), and a line it
composes itself ("You've hit your …", "You're out of usage credits", "Your org is out
of usage") as a synthetic assistant message and in an error result.

- Either is read as "out of quota". The account is blocked until the reset the CLI
  gave, or for `CLAUDE_CLI_QUOTA_RETRY_MS` (10 minutes) when it gave none, which is
  how often it is tried again. Per account (config directory or token digest), in
  memory; a block never shortens a longer one.
- While blocked, nothing is spawned: the request is answered **429** with the reset
  time at once. `parseError` hands the reset to `markAccountUnavailable`, which locks
  the model on that account until then (capped at 30 minutes, so the account is
  probed again at least that often — a probe of a rejected account is instant and
  costs no model call), and the combo goes on to its next model.
- The request that finds out is answered 429 too, not as a stream carrying the limit
  message: the response is held back until the CLI has said enough to tell — its
  rate-limit report at the start of the turn ("allowed"), else the first content or
  the result — and at most `CLAUDE_CLI_QUOTA_PROBE_WAIT_MS` (10 s). Past that a 200
  goes out, and a limit found later only blocks the requests that follow.
- Only the CLI's own message counts: the line must start the text and be short (an
  error result can carry the model's own answer — a `max_tokens` cut comes back
  `is_error` — which may say "you've reached your goal"); a model describing limits
  in its own words, an `allowed_warning`, a plain API 429/529, and a window that
  paid extra usage is covering (`isUsingOverage` / `overageStatus` allowed) do not
  block the account.
- A model-scoped window (`seven_day_opus`, `seven_day_sonnet`) blocks only that model
  family on the account; `five_hour` / `seven_day` block all of it. The block is in
  memory (a restart clears it) and is not shown in the dashboard.
- **Not observed:** an account actually being spent. The events above are read from
  the binary's schema and exercised with a stand-in CLI, not captured from a real
  exhausted subscription.

#### `-low` in a Codex model id is the effort, and wins over the client's

`cx/gpt-6-luna-low` strips `-low` from the model and uses it as `reasoning.effort` —
but only when the client sent no effort. Agent clients always send one, so the
suffix was thrown away and the model ran at the client's default (medium).
The `(low)` spelling already won over the client (thinkingUnified); the dash
spelling now does too: effort in the model id > `reasoning.effort` >
`reasoning_effort` > default. The dash form takes none/minimal/low/medium/high/xhigh;
`max` is written `(max)`.

#### Effort can be set per model

The provider-level "Thinking" selector is one value for all of a provider's models,
and only fills in an effort the client did not send. Each model on the provider's
page now has an **Effort** selector (the levels that model takes, from
`getThinkingLevels`), stored as `providerThinking[provider].models[modelId]` next to
the provider-wide `mode` (saving one no longer drops the other). It is the
operator's choice for that model, so it is applied **over** the client's effort
(`open-sse/services/modelEffort.js`); an effort written into the request's model id
still wins over it. A level the model does not take is ignored rather than sent. It
is written where the client's format reads it: `reasoning_effort` /
`reasoning.effort` for OpenAI-shaped bodies, `output_config.effort` for Claude-shaped
ones; Gemini-shaped bodies are left alone (a thinking budget, not a named effort).
The selector is not shown for the Claude Code CLI provider, which has no effort to set.
The provider-wide "Thinking" mode is unchanged and still only fills a gap — and it
still writes `reasoning_effort` whatever the client's format, which a native Claude
passthrough sends upstream as-is.

#### `response_format` works on the Claude Code CLI provider

`response_format: json_object` / `json_schema` was refused with a 400
(`unsupported_response_format`, "Claude Code CLI cannot guarantee a JSON
response") on the premise that the CLI has no structured-output mode. It has one:
`claude -p --json-schema <schema>`. Before the refusal existed (5e07d2fd) the
field was dropped without a word, so a JSON reply was the model's good manners,
not a guarantee; since then every such request failed, and a combo that fell
through to this provider failed on it.

Measured on 2.1.285, under the flags this provider always passes (`--max-turns 1
--tools ""`, and again over `stream-json` with and without replayed history): the
answer does not arrive as text. The model calls an internal `StructuredOutput`
tool, the turn ends on `stop_reason: "tool_use"` with `is_error: false`, and the
`result` event carries the validated JSON as `structured_output`.

- `json_schema` → `--json-schema <the bare schema>` (OpenAI wraps it in
  `json_schema.schema`; the CLI takes it unwrapped). `json_object` → `{"type":
  "object"}`.
- The stream translator leaves that internal tool call out — it is not a call for
  the client to run — drops prose around it, and delivers `structured_output` as
  the message content, finishing with `stop` rather than `tool_calls`. Delivered
  from the result, not streamed, because the CLI validates it there: streamed
  fragments could be JSON the CLI then refuses. So a structured answer arrives
  whole rather than token by token.
- No fallback to prose, and none to unvalidated JSON: only `structured_output` has
  been through the CLI's validation, so a structured turn without it (the CLI gave
  up, the model never called the tool, or `max_tokens` cut it short) is an error
  (`structured_output_missing`) even if the result text happens to parse.
- A delivered answer always finishes `stop`, including when the CLI flagged the
  turn for a token ceiling (`length` would make openai-python's `parse()` reject a
  correct answer).
- A structured failure is the request's, not the account's, so it carries
  **HTTP 422**: `structured_output_missing`, `error_max_structured_output_retries`
  and (no tools are on offer) `error_max_turns`. A non-streaming client reads the
  status off the error frame, and without one it is a 502 — which the account loop
  answers by locking the model on that account for 30 seconds and failing over.
  Other failures keep the status they had.
- The CLI retries validation itself inside the one turn: a schema pinning `answer`
  to 5 for "2+2" came back `{"answer":5}` after a retry. `$schema: draft-07` (what
  zod-to-json-schema emits) passes through.
- Still refused, with a reason: a schema whose top level is not an object (the CLI
  answers through a tool, and a tool's input is an object); a schema over 12,000
  characters (one argv element; Windows escapes every `"` to `\"`, so it can
  double, against a 32,767-character command line); a schema with more than 2,000
  objects/arrays, JSON nested deeper than 32 levels (about 15 levels of nested
  objects), more than 6,000 values in all, or more than 32 `$ref`s (counted
  wherever they sit, so none hide under `dependencies` or another map); and
  `response_format` together with tools the request would advertise — how the two
  compete for the one turn was not measured. `tool_choice: "none"` or no tools is
  fine.
- Why the complexity limits: the CLI compiles the schema with Ajv and validates
  synchronously in the child, so a small schema can be expensive — a chain of
  `allOf` entries with two `$ref`s each doubles per level (ajv 8.20: 72 ms at depth
  24, 301 ms at 26, about 80 minutes by 40, from 2.6 KB). The walk that checks the
  limits is iterative, counts every value (plain numbers too), and runs before
  anything serializes the schema: a schema nested tens of thousands of levels deep
  would otherwise make `JSON.stringify` throw out of `execute()` — a 502 and the
  same lock — and a 10 MB array of ones cost 555 MB of heap and 700 ms to walk
  (now 0.2 MB and under a millisecond; it is refused as too many values). **Not
  bounded:** a `pattern` that backtracks catastrophically against what the model
  writes cannot be told from an ordinary one without a regex analyser; the 180 s
  idle timeout ends a child stuck on one.
- Structured turns skip the session cache: the CLI files that turn's transcript
  with its own `StructuredOutput` call in it, which is not what the client's
  history says happened. The log says so when the cache is on.
- The CLI's stderr is logged quoted, so text it echoes from a request (a schema's
  keywords) cannot forge log lines.

#### Scheduled keepalives no longer silently skip a slot

A cron keepalive fired only if a scheduler tick landed on the slot's exact
minute, and nothing ever caught up afterwards. So a slot was lost whenever that
one tick missed it: a tick still busy with the previous ping, an earlier
account's `claude -p` running the next account past the minute (reproduced in
`quota-autoping-cron.test.js`: two accounts on one slot, a 70 s ping, the second
account never pinged), or a pod restart across it. A keepalive meant to open a
5h window on a fixed clock is worthless when it skips.

- A slot now fires late rather than never: the scheduler takes the latest slot
  in the last `cronCatchUpMinutes` (15) that has not fired yet. The fire key is
  the slot's own minute, so a late slot still fires once.
- A failed ping is recorded (`lastCronFailedAt`) but never as the fire key, so
  it is retried after the 5-minute cooldown, inside the same window.
- The log line says how late a slot fired (`… (0 7 * * *, 3m late)`).
- The Claude Code accounts card shows the last keepalive, sent or failed, in the
  schedule's timezone, and the schedule badge names its timezone. An unset one
  reads "server time", which in the container is UTC — the easiest way for a
  schedule to run at the wrong hour.

### Features

#### Claude Code CLI: the prompt cache survives across turns (`CLI_CLAUDE_SESSION_CACHE=1`, off by default)

Every turn of a conversation through `claude-cli` used to reprocess the whole
history: only the system prompt was ever read back from cache. The cause,
measured on 2.1.281 with the real binary against a local stand-in for the API:
replaying a conversation through `--input-format stream-json` folds the
`shouldQuery: false` history into the newest user turn — the assistant turn
goes first, every earlier question arrives inside the newest turn behind the
CLI's reminders — so the prefix differs from the previous request's at the
first message.

With the flag on, each conversation continues its own Claude Code session:
the first turn runs as today under `--session-id`, and a turn whose history is
exactly what this server answered last time runs `--resume <id>` with the
newest turn alone. The CLI rebuilds the conversation from its own session file
and the request repeats the previous one through the CLI's own breakpoint.
Still `claude -p`, still the CLI's own auth and request — no relay, no
base-URL override, nothing rewritten.

Measured live on haiku through the whole server, three turns each:

| path | turn 2 read back | turn 3 read back |
|---|---|---|
| today (flag off) | 6,424 of 8,120 (the system prompt) | 6,424 of 9,484 |
| session cache | 8,138 of 8,148 | 9,577 of 9,587 |

- A conversation this server has not answered before — a history that
  arrived from elsewhere, or the first turn after a restart — is written as a
  transcript and resumed, so the model sees the history in order. Without
  this (and on today's path with the flag off) the CLI folds every earlier
  question into the newest turn, assistant turns first, and the model
  re-answers them; measured live, "And of Korea?" after Paris/Tokyo now
  answers "Seoul." alone.
- A turn that ended by proposing a tool call is never continued: under
  `--permission-mode dontAsk` the CLI closes that call in its own transcript
  with a denial, and a resumed turn carrying the client's real result for the
  same id is dropped (measured). The tool-result turn runs the fresh replay,
  which pairs it correctly. So this helps chat-style conversations — a text
  answer followed by the next question — and does little for tool loops.
- A resume whose session is gone is answered in full by a fresh run within the
  same request, as long as nothing has reached the client yet.
- Sessions are kept in the account's `<config>/projects/` and deleted when
  their entry expires (15 minutes; the cache itself lasts five). A previous
  process's leftovers are cleared on first use, only in this provider's own
  marked directories.
- `usage.prompt_tokens_details.cached_tokens` / `cache_creation_tokens` are now
  reported, and the quota card says what share of each account's prompt came
  from cache — a cache that stops hitting fails silently otherwise.
- `CLI_CLAUDE_UPSTREAM_OVERRIDE` (loopback only, test harnesses only) points the
  child at `scripts/fork/lib/fake-anthropic.mjs`, so all of this can be checked
  without spending subscription usage: `scripts/fork/check-claude-cli-cache-offline.mjs`,
  `scripts/fork/check-claude-cli-resume-cache.mjs --offline`.
- The cache relay (`CLI_CLAUDE_CACHE_RELAY`) is superseded and stays off: it
  answers, but cannot make a folded replay's prefix recur.

Known and not changed here: with the flag off, and on the first turn of a
session, the replayed history still reaches the model folded as above. See
docs/fable/2026-09-24-claude-cli-prompt-cache-design.md.

#### API Key Usage page: a per-key time series, a table of its own, and CSV export

The per-key breakdown used to be three clicks into the general Usage page's
table. It gets its own menu entry (`/dashboard/api-key-usage`), a stacked bar
chart of tokens per key over time, and a CSV export of the same table the
page renders.

- `GET /api/usage/api-keys?period=<period>` returns `{ series, keys }` for
  the chart; `&format=csv` streams the key x model table as RFC-4180 CSV
  from the same `byApiKey` the table renders, so the file and the screen
  cannot disagree.
- The chart and the table key on one identity function, `apiKeyBucketId`
  (`src/lib/db/repos/apiKeyUsageRepo.js`): a live key's UUID, an 8-hex-char
  SHA-256 prefix of the raw key for a deleted one, or the literal
  `local-no-key` — never the raw key, and never the masked form either (see
  the fix below for why the masked form can't be used as an identity).
- The table itself is the existing one: `UsageStats.js`'s API-key column
  definitions and render functions were exported rather than copied, so the
  two pages cannot drift apart.

**Not verified by running it.** Only the data layer (`apiKeyUsageRepo.js`,
the route, and the re-keying in `usageRepo.js` below) is covered by tests.
The page and the chart have not been built or rendered — no jsdom or
component-test infrastructure exists in this repo, and a build was off the
table for this task — so their correctness is static (props, exports and
route shapes read by eye), not observed.

### Removed

#### The ChatGPT Web provider, and its bridge container

Removed after it was found not to work at all as a routed provider, and it had
been shipped in a state where connecting succeeded and every request then
failed.

The codex-chatgpt-web bridge is built for the Codex CLI specifically, not for a
proxy in front of it. Every request must carry Codex's own turn metadata —
`client_metadata["x-codex-turn-metadata"]` with `turn_id`/`thread_id`, a
current-turn user message owning that `turn_id`, and a trusted
`<environment_context>` naming cwd, absolute roots and a sandbox mode. Without
it the bridge throws before doing anything:

    ChatGPT web requires native Codex turn_id metadata for browser-turn retry budgeting

This is not a missing field that could be filled in. `trustedEnvironmentText()`
deliberately refuses to read environment context out of a raw Responses request
at all — its own comment says parsed system text "has already lost the wire
provenance needed to distinguish Codex context from user-authored XML, so it
must never become filesystem authority". Supplying it from a proxy is the exact
thing that check exists to prevent.

All 47 published bridge tags were checked, down to the first release: every one
of them requires `turn_id`. There is no version to pin to.

What went with it: the provider registry entry and executor, the session and
settings routes, the bridge card, the connection mirror, the Docker image under
`docker/chatgpt-web/`, the compose service, the Kubernetes sidecar and its PVC,
and the checks that covered them. `docker/router-entrypoint.sh` went too — it
existed only to keep the router's recursive chown off the browser profile — so
the runtime entrypoint is upstream's again and that Dockerfile hunk stops being
a merge conflict.

The Claude Code CLI provider is unaffected.

### Fixes

#### `/api/usage/stats` was returning every raw API key as a JSON property name

`stats.byApiKey` was keyed `${rawApiKey}|${model}|${provider}` in the HTTP
response, not just in storage — so every raw API key that had ever made a
request rode along on every poll of the Usage page, and the dashboard copied
those keys straight into client-side React state. A deleted key's row also
fell back to `apiKey.slice(0, 8) + "..."` for its label, the same prefix
`maskApiKey` shows elsewhere — no new information, but still a slice of the
real key sitting in a table cell.

Fixed by introducing one identity function, `apiKeyBucketId` (also the base
for the API Key Usage chart above): a live key's id from the API-keys table,
an 8-hex-char SHA-256 prefix of the raw key for a key that has since been
deleted, or `local-no-key`. `getUsageStats`'s response is re-keyed on all
three code paths that build `byApiKey` — the daily rollup, the
`usageHistory` overlay that updates `lastUsed`, and the raw-row 24h/today
path — and deleted-key labels changed to `(deleted) <hash>`.

**The stored aggregate is untouched on purpose.** `usageDaily.data.byApiKey`
in SQLite is still keyed `${rawApiKey}|${model}|${provider}` — re-keying the
store would orphan every day already accumulated. Only the value this
function *returns*, which is what reaches the browser, is re-keyed.

Not `maskApiKey` for the deleted-key fallback: every 9Router API key is
`sk-${machineId}-${keyId}-${crc}` (`generateApiKeyWithMachine`,
`shared/utils/apiKey.js`) and `machineId` is constant for an install, so
`maskApiKey`'s first 8 characters are identical for every key on that
machine — every deleted key would have collapsed into one bucket, in both
the table and the chart. Covered by
`tests/unit/usage-stats-no-raw-keys.test.js` (behavioral: no raw key appears
in any property name of the response) and the updated AUDIT-002 assertion in
`tests/unit/security-audit.test.js` (source guard).

## Earlier, on top of v0.5.81

### Features

#### One install brings the local providers with it

Both providers that depend on something outside 9Router now ship with the
Docker deployment, so `docker compose up -d` is the whole setup.

**Claude Code CLI** — `@anthropic-ai/claude-code` is installed in the image
(pinned). A container has no terminal for the sign-in TUI, so accounts are
attached with a token from `claude setup-token`, pasted into the dashboard.
Several tokens means several accounts, and 9Router falls back between them.
On a desktop the interactive login still works and each account keeps its own
Claude Code config directory.

**ChatGPT Web** — a sidecar container runs the bridge with **no Electron and
no VNC at all**: the worker launches Chromium itself on a bare Xvfb, with no
launcher GUI, window manager or compositor.

You sign it in from the dashboard by pasting your chatgpt.com session, which
the bridge stores and then verifies by opening the account in its own browser.
The bridge authenticates from a stored Playwright session rather than a live
one, so a remote desktop was never actually required — earlier versions of
this image shipped an Electron launcher, and then Xvfb + x11vnc + noVNC,
resident permanently for a once-per-account login. (`BRIDGE_HEADLESS=1`
removes the X server too, but is not the default — upstream never runs
headless, so bot detection and the DOM automation are untested there.)

The session persists in a volume, so this is a once-per-account step. What it
replaced, in order: a Login button that called `open` server-side — which
opens a browser on the machine running Node, and so did nothing at all in a
container — then an Electron launcher on a permanent Xvfb with x11vnc and
noVNC, and finally an on-demand version of that same console.

Upstream's terminal setup is not used because `prepareSetup()` gates it on
macOS (*"Terminal-only managed Chrome setup currently requires macOS"*). That
gate is in the setup path only, so the image writes config.json with the
bridge's own `defaultConfig()` and `saveConfig()` instead.

Also fixed along the way:

- A `noAuth` provider now uses its real connection rows when it has any.
  Upstream returned one synthetic "Public" connection and never looked, which
  is why multi-account never worked for either provider.
- The green **Ready** badge no longer appears for a provider that needs local
  setup — it shows "N Connected" or "No connections" like everything else.
- The bridge URL may be a container or private-network address, not only
  loopback. Public hosts and link-local (169.254, the cloud metadata service)
  are still refused.


#### Agent Skills (new)

A **Skills** menu entry now installs third-party `SKILL.md` documents from
GitHub and toggles each one on or off. An enabled skill is appended to the
system prompt of every routed request, translated into whatever wire format
the chosen provider speaks — so the same skill works on Claude, Gemini, Kiro
and any OpenAI-compatible provider.

- Paste a repo URL (`github.com/owner/repo`), a blob link, or a raw
  `SKILL.md` link. A repo publishing several skills asks which one.
- YAML frontmatter supplies the name, description and license; it is stripped
  from the injected text, since it is runtime metadata the provider cannot act on.
- The document body is stored in SQLite, so a routed request never depends on
  GitHub being reachable. "Re-fetch" pulls a newer version on demand.
- Each skill shows its size and estimated token cost, and the card totals what
  the enabled set adds to every request — a skill costs tokens rather than
  saving them, which is worth seeing next to Token Saver.
- Skills install **disabled**; enabling one is a separate, deliberate action.
- Only `github.com` and `raw.githubusercontent.com` are accepted, and every
  fetch goes through the SSRF guard.

Verified against `ayghri/i-have-adhd` (~1,697 tok) and `epoko77-ai/im-not-ai`
(multi-skill repo, prompts for a choice).

- **ChatGPT Web** (`chatgpt-web` / `cgw`): new provider that routes through the
  [codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web) bridge, turning a signed-in
  chatgpt.com session into an OpenAI Responses endpoint. Sign-in happens inside the bridge's own
  window; the provider page shows daemon health, the models that session exposes, and a Login
  button. Endpoint comes from `CHATGPT_WEB_BASE_URL` (loopback only); loopback traffic bypasses
  the outbound proxy.
- **Claude Code CLI** (`claude-cli` / `ccli`): new provider that spawns the local `claude -p`
  binary instead of replaying an OAuth token from the server, which is what makes the plain
  `claude` provider a ban risk. Runs with `--tools ""`, `--setting-sources ""` and
  `--strict-mcp-config`, so host hooks, CLAUDE.md and MCP servers never reach a routed request;
  streams `stream-json` back as OpenAI chunks. Text/reasoning only — tool calling is not bridged.
- **Auto-ping cron**: quota auto-ping gains cron schedules — several expressions per connection,
  an IANA timezone (validated on save), a custom message (default "Only Hi"), and an optional
  `via: "cli"` mode that sends the keepalive through the Claude Code CLI. Schedules fire
  independently of the reset-based ping, skip an exhausted window, and dedupe per minute across
  restarts. The CLI keepalive is bounded by its own timeout so a hung child cannot stall the tick.

### Hardening

Found by review before this ever ran in anger; all covered by regression tests.

- **Claude Code CLI**: `max_turns` from the request body is clamped to a bounded integer before it
  can reach argv, and `--model` is regex-validated and may not begin with `-`. Nothing is spawned
  through a shell any more: a Windows `.cmd`/`.bat` shim is resolved to its package entry point and
  run with the server's own Node, or the request is refused — cmd.exe has no usable argument
  escaping, so routing argv through it was an injection surface.
- **Claude Code CLI**: the child receives an allowlisted environment instead of a copy of
  `process.env`, so a routed request's subprocess no longer sees `JWT_SECRET`, `API_KEY_SECRET` or
  any stored provider key. Host paths and child stderr stay in the server log, not in the response.
- **Claude Code CLI**: concurrency is capped (default 4, `CLI_CLAUDE_MAX_CONCURRENCY`) behind a
  FIFO queue — each request spawns a ~230 MB interpreter. Deterministic failures return a real HTTP
  status instead of a 200 carrying an error frame, so account/combo fallback engages and
  Claude-format clients are not left with a silent empty stream.
- **Claude Code CLI**: cancelling the response body kills the child instead of leaking it and
  throwing from a stdout listener; usage rides the finish chunk so the estimator no longer wins and
  over-reports every request.
- **ChatGPT Web**: the bridge endpoint is validated as a loopback http(s) origin everywhere it is
  used, and `/api/cli-tools/chatgpt-web-settings` no longer fetches or opens a caller-supplied URL
  (SSRF). Both new `cli-tools` routes are registered localhost-only, next to the other routes that
  spawn processes or read host state, and the version probe uses `execFile` rather than a shell.

### Fixes

- **Non-streaming clients of forced-stream providers** (shared, affects upstream providers too):
  `handleForcedSSEToJson` converted the folded body to the caller's shape only for the Responses
  API, so a Claude-format caller (`/v1/messages`, `stream:false`) received an OpenAI
  `chat.completion` object it cannot parse. It now reuses the shared non-streaming translator.
  Applies to every `forceStream` provider (opencode, zed, codebuddy, …); OpenAI and Responses
  callers are byte-identical to before. **Candidate to upstream.**
- **Claude Code CLI**: a request with no system message inherited Claude Code's own agent prompt —
  measured 8,385 prompt tokens against 429 for the same one-line request, plus a coding-agent
  persona. An explicit system prompt is now always sent.
- **ChatGPT Web**: the routed endpoint comes from `CHATGPT_WEB_BASE_URL`. A noAuth provider gets a
  synthetic connection, so the per-connection override could never reach routing; the card now says
  its field only drives the status probe. An unusable endpoint returns an error response instead of
  throwing out of the executor.
