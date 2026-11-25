// Claude Code CLI provider (`claude -p`) — see executors/claude-cli.js.
export const CLAUDE_CLI_BASE_URL = "claude-cli://stdio";

// One turn per request: this is an inference endpoint, not an agent loop.
// The caller's tools reach Claude Code through an MCP server, because MCP is
// the only surface that takes arbitrary tool schemas — `--tools` selects from
// the CLI's own built-in set. The CLI namespaces every MCP tool it exposes as
// `mcp__<server>__<tool>`, so this name is also what has to be stripped back
// off before a proposed call is handed to the client that asked for it.
export const CLAUDE_CLI_MCP_SERVER = "ninerouter";
export const CLAUDE_CLI_MCP_TOOL_PREFIX = `mcp__${CLAUDE_CLI_MCP_SERVER}__`;

// Settings the child must not decide for itself.
//
// Every one of these is a way the CLI would otherwise act on its own behalf in
// the middle of somebody's API request: retrying upstream (and billing the
// subscription twice for one request), compacting the conversation the caller
// sent, searching for tools, phoning home, or replaying a token-budget reminder
// that invalidates the cached prefix. The same set the Hermes plugin pins.
export const CLAUDE_CLI_CHILD_ENV = {
  CLAUDE_CODE_MAX_RETRIES: "0",
  DISABLE_AUTO_COMPACT: "1",
  DISABLE_COMPACT: "1",
  ENABLE_TOOL_SEARCH: "false",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  CLAUDE_CODE_TOTAL_TOKENS_REMINDER: "off",
};

export const CLAUDE_CLI_DEFAULT_MAX_TURNS = 1;
export const CLAUDE_CLI_MAX_TURNS_LIMIT = 10;

/** `max_turns` arrives on the request body — it must never reach argv unchecked. */
export function resolveClaudeCliMaxTurns(value) {
  const turns = Number(value);
  if (!Number.isInteger(turns)) return CLAUDE_CLI_DEFAULT_MAX_TURNS;
  if (turns < 1 || turns > CLAUDE_CLI_MAX_TURNS_LIMIT) return CLAUDE_CLI_DEFAULT_MAX_TURNS;
  return turns;
}

// An account that reports it is out of quota is not asked again until its reset
// — or, when the CLI gave none, until this long has passed, which is how often it
// is tried again. A rejected subscription answers instantly and costs no model
// call, so a probe this often is cheap.
export const CLAUDE_CLI_QUOTA_RETRY_MS = 10 * 60 * 1000;

// How long a freshly spawned request is held back, before its response is
// handed on, to learn whether the CLI is about to say it is out of quota. That
// is said at the very start of a turn; past this the request is answered as a
// stream, and a limit found later only blocks the requests that follow.
export const CLAUDE_CLI_QUOTA_PROBE_WAIT_MS = 10000;

// `response_format` reaches the CLI as `--json-schema`. The CLI then answers
// through a tool of its own, by this name, whose input is the validated answer;
// it is the CLI's channel back to us, not a call for the client to run.
// Measured on 2.1.285 under `--max-turns 1 --tools ""`.
export const CLAUDE_CLI_STRUCTURED_OUTPUT_TOOL = "StructuredOutput";

// The schema is one argv element, and Windows caps a whole command line at
// 32,767 characters. Every `"` on that line is escaped to `\"`, so a schema can
// double in length on the way; the limit is set so even that leaves room for the
// rest of the line (flags, three file paths, the model — the system prompt goes
// through a file). A larger schema is refused with a reason rather than left to
// fail the spawn, which would answer 503 and lock the account.
export const CLAUDE_CLI_MAX_JSON_SCHEMA_CHARS = 12000;

// The CLI compiles the caller's schema with Ajv and validates the answer against
// it synchronously, inside the child, which blocks the child until it finishes
// (only the idle timeout ends it). A schema can be small and still expensive:
// a chain of allOf entries with two `$ref`s each doubles the work per level —
// measured with ajv 8.20, 72 ms at depth 24 and 301 ms at 26, about 80 minutes
// by depth 40 from 2.6 KB. Bounding the number of references bounds that: with
// at most 32, even a fan-out built to blow up (three per level) stays near 10^5
// evaluations per value validated (a `$ref` under `items` repeats that for each
// element the model writes). Values, nodes and depth bound the walk itself,
// which is iterative. Every value is counted, plain numbers included, and each
// takes at least a character and a separator — so a schema inside the character
// limit can never hold more than half that many values, and the walk costs what
// the limit allows rather than what the request carried.
//
// Not bounded here: a `pattern` that backtracks catastrophically against what the
// model writes. It cannot be told apart from an ordinary pattern without a regex
// analyser, and banning `pattern` would refuse far too many real schemas. The
// idle timeout is what ends a child stuck on one.
export const CLAUDE_CLI_JSON_SCHEMA_LIMITS = Object.freeze({
  maxNodes: 2000,
  maxDepth: 32,
  maxRefs: 32,
  maxValues: Math.floor(CLAUDE_CLI_MAX_JSON_SCHEMA_CHARS / 2),
});

// How a structured turn ends when the CLI could not get valid output out of the
// model: its own retries ran out (`error_max_structured_output_retries`, present
// in 2.1.285), or — with no tools on offer — the turn budget did
// (`error_max_turns`). Both are about this request's schema and prompt, not the
// account. A 502 here would lock the model on that account for 30 seconds and
// fail over to one that fails the same way; a 4xx other than 401/402/403/429 is
// handed back for this request alone (accountFallback.js).
export const CLAUDE_CLI_STRUCTURED_FAILURE_SUBTYPES = [
  "error_max_structured_output_retries",
  "error_max_turns",
];
export const CLAUDE_CLI_STRUCTURED_FAILURE_STATUS = 422;

// The child gets an allowlist, not a copy of the server environment: process.env
// here holds JWT_SECRET, API_KEY_SECRET, MACHINE_ID_SALT and every provider key.
// ANTHROPIC_* is deliberately excluded — the CLI must use its own stored login,
// and inheriting a base-url override could route the child back into 9Router.
export const CLAUDE_CLI_ENV_ALLOWLIST = [
  "PATH", "Path", "PATHEXT", "SystemRoot", "SystemDrive", "windir", "COMSPEC",
  "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "TMPDIR",
  "LANG", "LC_ALL", "TZ", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
  "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "SHELL", "USER", "LOGNAME",
  // Selects WHICH Claude Code account runs the request: each connection owns a
  // config directory, and Claude Code keeps its credentials per directory.
  // Without this the child always used the default account, so a second
  // account could be signed in but never reached.
  "CLAUDE_CONFIG_DIR",
  // A long-lived token from `claude setup-token`. This is how an account is
  // attached where no interactive login is possible — a container, most
  // obviously, which has no terminal for the sign-in TUI.
  "CLAUDE_CODE_OAUTH_TOKEN",
];

// Host settings that would send the child somewhere other than the operator's
// Claude subscription. None of them is on the allowlist, so none reaches the
// child and the routing is already correct — but an operator who set one meant
// it, and silently ignoring it is how someone spends an afternoon wondering why
// their Bedrock key is not being used. Named in the log instead.
//
// The Hermes plugin refuses the request outright for these. A gateway cannot:
// its environment is shared by every provider, and one stray variable would
// take down a route that works.
export const CLAUDE_CLI_CONFLICTING_ENV = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_FOUNDRY_API_KEY",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
];

/** Those of them this host actually has set to something meaningful. */
export function conflictingHostAuth(env = process.env) {
  return CLAUDE_CLI_CONFLICTING_ENV.filter((key) => {
    const value = env[key];
    if (value === undefined || value === "") return false;
    // The three switches are only a conflict when switched on.
    if (key.startsWith("CLAUDE_CODE_USE_")) {
      return !["0", "false", "no", "off"].includes(String(value).toLowerCase());
    }
    return true;
  });
}

// The cache relay, off unless asked for.
//
// It is the only part of this provider that is not simply `claude -p`: it puts
// a loopback HTTP hop between the child and the API so the prompt-cache
// breakpoint can be moved, which is worth a great deal on a long conversation
// — measured, the difference between reading 20k of cache back and reprocessing
// all of it every turn.
//
// It is off because it does not yet hold up. Against a real subscription the
// live suite scores 28/28 with it off and 4/28 with it on: the child's request
// reaches the relay and no response comes back, and the CLI drops the
// connection thirty seconds later. That failure then locks the account for
// thirty seconds, so one bad request takes every request behind it with it.
// The cause is not yet found — it does not reproduce outside the Next server,
// where the same relay carries the same request to the same API and answers 200.
//
// Until it does hold up, the default has to be the path that works. Set
// CLI_CLAUDE_CACHE_RELAY=1 to try it.
//
// Superseded by the session cache (CLI_CLAUDE_SESSION_CACHE, see
// executors/claudeCliSessions.js), which wins when both are on. Measured
// 2026-09-24 on 2.1.281, docs/fable/2026-09-24-claude-cli-prompt-cache-plan.md:
// driven inside the Next server against a local stand-in for the API, and then
// once against the real one, the relay answered every turn in ~2s with
// {"forwarded":1,"status":200} — the hang did not reproduce on a macOS host
// without a proxy. But it read back nothing past the system prompt: the replay
// folds history into the newest user turn, so the prefix diverges before any
// breakpoint the relay could move. Kept, off, so a CLI that replays in order
// can be re-measured with scripts/fork/check-claude-cli-cache-offline.mjs relay.
export function cacheRelayEnabled(env = process.env) {
  return String(env.CLI_CLAUDE_CACHE_RELAY ?? "0").toLowerCase() === "1";
}

// A stand-in for the API, for test harnesses only (scripts/fork/lib/fake-anthropic.mjs).
//
// Every diagnosis of the cache relay used to cost a real request, and every
// failed one locked the account for thirty seconds. With this set the child —
// or the relay, when it is on — talks to a local fake instead, so the exact
// bytes the CLI sends can be captured and the relay exercised inside the Next
// server without anything reaching Anthropic.
//
// Loopback HTTP only: the child sends its real credential to wherever this
// points, so anything that is not this host is refused outright. Never set in
// the Dockerfile, .env.example or a deployment.
export function upstreamOverride(env = process.env) {
  const raw = String(env.CLI_CLAUDE_UPSTREAM_OVERRIDE ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const loopback = ["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname);
    if (url.protocol !== "http:" || !loopback || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

// How a tool turn is written when the conversation cannot be replayed as turns.
// Prose, not a bracketed marker: a model that reads `[Tool call ...]` in its own
// history imitates it, writing the marker as text instead of proposing a call —
// which leaves the client waiting for one that never comes.
export const CLAUDE_CLI_TOOL_CALL_PREFIX = "(the assistant used the ";
export const CLAUDE_CLI_TOOL_RESULT_PREFIX = "(that tool returned: ";

// What a replayed turn is flagged for carrying: 9Router's own flattened forms
// above, plus the bracketed shape the other CLI providers still emit. A client
// can send either back as history, and both are shapes the model imitates.
// Kept beside the forms themselves so the detector cannot drift from them —
// it did once, and then matched nothing any current code produces.
export const CLAUDE_CLI_TRANSCRIPT_MARKERS = [
  CLAUDE_CLI_TOOL_CALL_PREFIX,
  CLAUDE_CLI_TOOL_RESULT_PREFIX,
  "[Tool call ",
  "[Tool result ",
];

// The CLI streams within seconds; a longer silence means a hung/blocked child.
export const CLAUDE_CLI_IDLE_TIMEOUT_MS = 180000;

// How long a child gets to exit by itself once it has delivered its answer.
// Its stdin closed before it started, so it should go at once; what does not
// always go is what it started — the MCP server, and on Windows the cmd.exe
// shim — and those hold the pipes that `close` waits for. `close` is what
// frees the gate slot, so a child that answers and then lingers would hold a
// slot with nothing left watching it.
export const CLAUDE_CLI_EXIT_GRACE_MS = 5000;

// Claude Code refuses to nest inside another Claude Code session, and 9Router
// may itself have been launched from one. A routed spawn is safe by omission
// (CLAUDE_CLI_ENV_ALLOWLIST does not carry these); the dashboard status probe
// strips them explicitly so its result matches what the runtime would get.
export const CLAUDE_CLI_NESTED_ENV_KEYS = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SSE_PORT",
];

// Each routed request spawns a whole Claude Code interpreter (~230 MB resident
// measured on 2.1.278), so a client that fans out subagents can exhaust the
// host. Requests past the limit queue instead of spawning.
export const CLAUDE_CLI_DEFAULT_MAX_CONCURRENCY = 4;
export const CLAUDE_CLI_QUEUE_TIMEOUT_MS = 120000;

export function resolveClaudeCliMaxConcurrency(env = process.env) {
  const raw = Number(env.CLI_CLAUDE_MAX_CONCURRENCY);
  if (Number.isInteger(raw) && raw > 0) return raw;
  return CLAUDE_CLI_DEFAULT_MAX_CONCURRENCY;
}

// `--model` is request-controlled (passthroughModels). Nothing is spawned through
// a shell any more, but the value still has to be a plausible model id, and the
// leading character may not be "-": commander would treat `--model --foo` as a
// missing value and re-parse the rest of argv, smuggling in a real flag.
export const CLAUDE_CLI_MODEL_PATTERN = /^[A-Za-z0-9._:[\]][A-Za-z0-9._:[\]-]{0,79}$/;

// A request with no system message must still replace Claude Code's default agent
// prompt. Leaving it in place costs ~8k prompt tokens per request (measured: 424
// with a system message vs 8,385 without) and gives the reply a coding-agent
// persona instead of the plain assistant an API caller expects.
export const CLAUDE_CLI_DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant responding to an API request.";

// Used when the caller's system prompt had to move into the stdin turn: it still
// replaces Claude Code's default agent prompt, which is the point of passing one.

// Routed model id → value passed to `claude --model`. Aliases stay as-is so the
// CLI keeps resolving "latest" itself; pinned ids pass through unchanged.
//
// Every value here was checked against the installed CLI (2.1.278) rather than
// assumed: an unknown one is refused with "isn't described by this version's
// model catalog", and none of these are.
//
//   opusplan   — Opus while planning, Sonnet to execute. A real Claude Code
//                mode ("mode_dependent_setting"), and previously missing here.
//   *[1m]      — the 1M-token context window. The CLI documents the suffix
//                itself: "/model sonnet[1m] for a 1M context window".
//                CLAUDE_CLI_MODEL_PATTERN already admits the brackets.
export const CLAUDE_CLI_UPSTREAM_MODELS = {
  "claude-cli-opus": "opus",
  "claude-cli-opus-1m": "opus[1m]",
  "claude-cli-opusplan": "opusplan",
  "claude-cli-sonnet": "sonnet",
  "claude-cli-sonnet-1m": "sonnet[1m]",
  "claude-cli-haiku": "haiku",
  "claude-cli-fable": "fable",
  "claude-cli-default": "default",
};
