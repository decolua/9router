/**
 * ClaudeCliExecutor — routes completions through the locally installed
 * Claude Code CLI (`claude -p`) instead of calling api.anthropic.com directly.
 *
 * Why: the `claude` provider drives the Anthropic OAuth endpoint with spoofed
 * CLI headers. Running the real binary keeps the traffic shape identical to an
 * ordinary Claude Code session (same client, same auth path), which removes the
 * ban risk that comes with replaying OAuth tokens from a server.
 *
 * Invocation (verified against claude 2.1.281):
 *   claude -p --output-format stream-json --verbose --include-partial-messages
 *          --model <model> --max-turns 1 --tools ""
 *          --setting-sources "" --strict-mcp-config
 *          --permission-mode dontAsk --disable-slash-commands
 *          --no-session-persistence --input-format stream-json
 *          [--system-prompt-file <path>] [--settings <path>] [--mcp-config <path>]
 *
 *   --tools ""            no Bash/Edit/Write — this is an inference endpoint,
 *                         not an agent loop running on the 9Router host.
 *   --setting-sources ""  ignore user/project/local settings, so the operator's
 *                         own hooks, CLAUDE.md and skills never leak into a
 *                         routed request (measured: 37,835 → 545 input tokens).
 *   --strict-mcp-config   no MCP servers from the host config.
 *   prompt on stdin       Windows caps a command line at ~32k chars.
 *
 * Auth: noAuth — the subprocess uses whatever `claude` itself is logged into
 * (subscription OAuth in ~/.claude, or ANTHROPIC_API_KEY in the host env).
 *
 * Streaming: `--include-partial-messages` emits `stream_event` lines carrying
 * raw Anthropic SSE events, which map 1:1 onto OpenAI chat.completion.chunks.
 *
 * Tool calling: bridged. The CLI's own tools stay off; the caller's are shown
 * through a generated MCP server that advertises them and runs none of them —
 * see claudeCliTools.js — and a proposed call goes back as `tool_calls`.
 */

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { BaseExecutor } from "./base.js";
import { SSE_DONE, SSE_HEADERS } from "../utils/sseConstants.js";
import { chatChunkSse, sseChunk } from "../utils/sse.js";
import {
  CLAUDE_CLI_BASE_URL,
  CLAUDE_CLI_DEFAULT_MAX_TURNS,
  CLAUDE_CLI_EXIT_GRACE_MS,
  CLAUDE_CLI_TOOL_CALL_PREFIX,
  CLAUDE_CLI_TOOL_RESULT_PREFIX,
  CLAUDE_CLI_IDLE_TIMEOUT_MS,
  CLAUDE_CLI_MCP_TOOL_PREFIX,
  CLAUDE_CLI_MODEL_PATTERN,
  CLAUDE_CLI_QUOTA_PROBE_WAIT_MS,
  CLAUDE_CLI_STRUCTURED_FAILURE_STATUS,
  CLAUDE_CLI_STRUCTURED_FAILURE_SUBTYPES,
  CLAUDE_CLI_STRUCTURED_OUTPUT_TOOL,
  CLAUDE_CLI_DEFAULT_SYSTEM_PROMPT,
  CLAUDE_CLI_CHILD_ENV,
  CLAUDE_CLI_ENV_ALLOWLIST,
  cacheRelayEnabled,
  upstreamOverride,
  conflictingHostAuth,
  CLAUDE_CLI_QUEUE_TIMEOUT_MS,
  CLAUDE_CLI_UPSTREAM_MODELS,
  resolveClaudeCliMaxConcurrency,
  resolveClaudeCliMaxTurns,
} from "../config/claudeCli.js";
import { createConcurrencyGate } from "../utils/concurrencyGate.js";
import {
  callerToolName,
  toolNameMap,
  inertMcpServerSource,
  mcpConfigDocument,
  toMcpManifest,
} from "./claudeCliTools.js";
import { buildReplayFrames, describeFrames, framesToStdin, transcriptSeed, transcriptRecords } from "./claudeCliReplay.js";
import {
  recordRateLimitEvent, rateLimitAccountKey, recordCacheUsage,
  quotaExhaustion, markQuotaExhausted, quotaBlockedUntil,
} from "./claudeCliRateLimits.js";
import {
  sessionCacheEnabled,
  sharedSessionRegistry,
  sessionCacheKey,
  conversationKey,
  splitQueryFrame,
  sessionConfigDir,
  sessionFileExists,
  sessionProjectDir,
  createAnswerRecorder,
} from "./claudeCliSessions.js";
import { startAdmission } from "./claudeCliAdmission.js";
import {
  generationExtraBody,
  ignoredRequestFields,
  outputTokenCeiling,
  structuredOutputSchema,
  toolsAreWanted,
  unsupportedRequestFeature,
} from "./claudeCliRequestSupport.js";

// ─── Binary discovery ────────────────────────────────────────────────────────

function claudeBinCandidates() {
  const home = os.homedir();
  const isWin = process.platform === "win32";
  if (!isWin) {
    return [
      path.join(home, ".local", "bin", "claude"),        // native installer
      path.join(home, ".claude", "local", "claude"),     // legacy local install
      path.join(home, ".bun", "bin", "claude"),
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude",
      "/usr/bin/claude",
    ];
  }
  const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
  return [
    path.join(home, ".local", "bin", "claude.exe"),      // native installer
    path.join(localAppData, "Programs", "claude", "claude.exe"),
    path.join(appData, "npm", "claude.cmd"),             // npm -g shim
    path.join(home, "scoop", "shims", "claude.exe"),
    path.join(home, ".bun", "bin", "claude.exe"),
  ];
}

// Exported so the dashboard status route reports exactly what the runtime spawns.
export function resolveClaudeBin() {
  const envBin = process.env.CLI_CLAUDE_BIN?.trim();
  if (envBin) return envBin;

  for (const candidate of claudeBinCandidates()) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch { /* unreadable path — keep probing */ }
  }
  return process.platform === "win32" ? "claude.exe" : "claude";
}

/**
 * Private working directory for the child.
 *
 * It must not be a shared location: Windows' executable search includes the
 * current directory, so spawning the bare name `claude.exe` (the PATH fallback)
 * from a world-writable `%TEMP%` would run a planted binary. A directory created
 * here cannot be pre-populated by anyone else. It also keeps any stray CLAUDE.md
 * out of the child's view.
 */
let spawnCwd = null;
export function resolveSpawnCwd() {
  if (spawnCwd && fs.existsSync(spawnCwd)) return spawnCwd;
  spawnCwd = fs.mkdtempSync(path.join(os.tmpdir(), "9router-claude-"));
  return spawnCwd;
}

export function resolveShimTarget(bin) {
  const dir = path.dirname(bin);
  const candidates = [
    path.join(dir, "node_modules", "@anthropic-ai", "claude-code", "cli.js"),
    path.join(dir, "..", "lib", "node_modules", "@anthropic-ai", "claude-code", "cli.js"),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return path.resolve(candidate);
    } catch { /* keep probing */ }
  }
  return null;
}

// `.cmd`/`.bat` shims cannot be spawned directly on Windows (Node refuses since
// CVE-2024-27980), and cmd.exe is not the way around it — it has no usable
// escaping, so every argv value would become an injection vector. buildSpawnPlan
// resolves the shim to the package's own cli.js and runs that instead.
export function isShimPath(bin, platform = process.platform) {
  return platform === "win32" && /\.(cmd|bat)$/i.test(bin);
}

/**
 * Always an argv array, never a shell string — the request body can therefore
 * never introduce a second argv element or a shell operator.
 * @returns {{command:string,args:string[],options:object}|{error:string}}
 */
export function buildSpawnPlan(bin, args) {
  if (!isShimPath(bin)) return { command: bin, args, options: {} };

  const target = resolveShimTarget(bin);
  if (!target) {
    return {
      error: "Claude Code resolved to a .cmd shim whose package could not be located. "
        + "Set CLI_CLAUDE_BIN to the claude executable (or the CLI's cli.js).",
    };
  }
  // process.execPath is this server's own Node — no PATH lookup, no shell.
  return { command: process.execPath, args: [target, ...args], options: {} };
}

// ─── Request shaping ─────────────────────────────────────────────────────────

// Tool turns are described here, not marked. This form is only reached when
// the conversation cannot be replayed as turns at all, and a model that reads
// a bracketed `[Tool call ...]` in its own history imitates it — writing the
// marker as text instead of proposing a call, which leaves the client waiting
// for one that never comes.
function blockText(part) {
  if (!part || typeof part !== "object") return "";
  if (typeof part.text === "string") return part.text;
  if (typeof part.input_text === "string") return part.input_text;
  if (part.type === "tool_use") {
    return `\n${CLAUDE_CLI_TOOL_CALL_PREFIX}${part.name} tool with ${JSON.stringify(part.input ?? {})})\n`;
  }
  if (part.type === "tool_result") {
    const body = typeof part.content === "string" ? part.content : JSON.stringify(part.content ?? "");
    return `\n${CLAUDE_CLI_TOOL_RESULT_PREFIX}${body})\n`;
  }
  return "";
}

function messageText(message) {
  if (typeof message?.content === "string") return message.content;
  if (Array.isArray(message?.content)) {
    return message.content.map((part) => (typeof part === "string" ? part : blockText(part))).join("");
  }
  return "";
}

/**
 * Split an OpenAI/Claude message array into the `--system-prompt` payload and a
 * single flattened turn. `claude -p` owns one conversation turn, so prior turns
 * are inlined with role markers — the same approach grok-web/perplexity-web use.
 */
export function buildClaudeCliPrompt(messages) {
  const systemParts = [];
  const turns = [];

  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message) continue;
    // "function" is the older OpenAI spelling of "tool"; normalised here so a
    // tool's output is not flattened in as something the user said.
    const rawRole = String(message.role || "user");
    const role = rawRole === "function" ? "tool" : rawRole;
    let text = messageText(message);

    if (role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length) {
      const calls = message.tool_calls.map((call) => {
        const name = call.function?.name || call.name || "tool";
        const args = call.function?.arguments ?? call.arguments ?? {};
        return `${CLAUDE_CLI_TOOL_CALL_PREFIX}${name} tool with ${typeof args === "string" ? args : JSON.stringify(args)})`;
      });
      text = [text, ...calls].filter(Boolean).join("\n\n");
    }
    if (role === "tool") {
      const body = typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "");
      text = `${CLAUDE_CLI_TOOL_RESULT_PREFIX}${body})`;
    }
    if (!text.trim()) continue;

    if (role === "system" || role === "developer") systemParts.push(text);
    else if (role === "assistant") turns.push(`[Assistant]\n${text}`);
    else if (role === "tool") turns.push(`[Tool]\n${text}`);
    else turns.push(`[User]\n${text}`);
  }

  // A single user turn needs no role marker — keep the prompt as close to a
  // plain question as possible so the model does not mimic the transcript shape.
  const onlyUserTurn = turns.length === 1 && turns[0].startsWith("[User]\n");
  const turnsText = turns.join("\n\n");
  return {
    system: systemParts.join("\n\n"),
    prompt: onlyUserTurn ? turns[0].slice("[User]\n".length) : turnsText,
    // Role-marked form, used when the system prompt has to ride along in stdin.
    turnsText,
  };
}

/**
 * Decide how one request reaches the CLI.
 *
 * The system prompt goes on argv when it safely fits, because a real
 * `--system-prompt` has higher fidelity than instructions embedded in the turn.
 * It moves into stdin only when it would blow the platform's command-line limit.
 * (Nothing is ever spawned through a shell, so argv itself is not an injection
 * surface — see buildSpawnPlan.)
 */
export function planClaudeCliInvocation({ model, messages, maxTurns, tools, jsonSchema }) {
  const { system, prompt } = buildClaudeCliPrompt(messages);
  // Advertised to the CLI through MCP, never executed here — see
  // claudeCliTools.js. It leaves the plan as data so the spawn can write it to
  // a file, which keeps this function a pure function of the request.
  const manifest = toMcpManifest(tools);
  // One turn per request, always — the same value the Hermes plugin passes.
  //
  // With tools advertised it is forced anyway: given another turn the CLI would
  // go on to *invoke* the inert server, read its refusal, and answer with an
  // apology, losing the tool call the client was waiting for. Without tools it
  // used to honour a caller's `max_turns`, which is a 9Router extension the
  // plugin does not have — and it is incompatible with admitting exactly one
  // model call through the cache relay. An agent loop belongs to the client;
  // this endpoint answers once.
  const turnLimit = CLAUDE_CLI_DEFAULT_MAX_TURNS;

  // Replay the conversation as turns when it can be: the model then has had the
  // conversation rather than reading a transcript of one, and a tool result is
  // a result linked to the call that produced it instead of a line of prose.
  const replay = buildReplayFrames(messages, CLAUDE_CLI_MCP_TOOL_PREFIX);
  const replayed = Boolean(replay.frames);

  return {
    args: buildClaudeCliArgs({ model, maxTurns: turnLimit, streamJsonInput: replayed, jsonSchema }),
    stdin: replayed ? framesToStdin(replay.frames) : prompt,
    // Recorded with the request so a looping client can be diagnosed from the
    // dashboard instead of from a guess.
    shape: replayed ? describeFrames(replay.frames) : { turns: 0, flattened: true },
    // Never empty: without a system prompt Claude Code applies its own agent
    // prompt, which is neither what an API caller asked for nor what they
    // expect to pay for. It goes to a file, so its size never matters.
    system: (replayed ? replay.system : system) || CLAUDE_CLI_DEFAULT_SYSTEM_PROMPT,
    frameCount: replayed ? replay.frames.length : 0,
    frames: replayed ? replay.frames : null,
    // The content of the turn actually being asked. The admission relay needs
    // it to tell 9Router's own blocks from the per-request context the CLI
    // appends to that same turn — which is where the cache breakpoint must not
    // land. Only meaningful for a replayed conversation.
    queried: replayed ? (replay.frames.at(-1)?.message?.content || null) : null,
    replayed,
    manifest,
  };
}


/** Resolved upstream model id, or null when it is not safe to put on argv. */
export function resolveClaudeCliModel(model) {
  const upstream = CLAUDE_CLI_UPSTREAM_MODELS[model] || model;
  if (!upstream) return null;
  return CLAUDE_CLI_MODEL_PATTERN.test(upstream) ? upstream : null;
}

export function buildClaudeCliArgs({
  model, system, systemPromptFile, settingsFile, maxTurns, mcpConfigFile, streamJsonInput,
  sessionId, resumeId, jsonSchema,
} = {}) {
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--max-turns", String(resolveClaudeCliMaxTurns(maxTurns)),
    "--tools", "",
    "--setting-sources", "",
    "--strict-mcp-config",
    // Nothing here may wait for a human. Without these the CLI can stop on a
    // permission prompt with no terminal to answer it, which reaches the client
    // as a stream that simply stops.
    "--permission-mode", "dontAsk",
    "--disable-slash-commands",
  ];
  // One request is one turn. Without the session cache nothing is ever
  // resumed — every request arrives carrying its own history — so a saved
  // session would only accumulate on the host. With it, the session is the
  // point: resuming it is what lets the prompt cache hit (claudeCliSessions.js),
  // and the registry deletes it when it expires.
  if (resumeId) args.push("--resume", resumeId);
  else if (sessionId) args.push("--session-id", sessionId);
  else args.push("--no-session-persistence");
  // History goes in as real turns rather than a transcript pasted into one
  // prompt — see claudeCliReplay.js.
  if (streamJsonInput) args.push("--input-format", "stream-json");
  const upstreamModel = resolveClaudeCliModel(model);
  if (upstreamModel) args.push("--model", upstreamModel);
  // From a file: a coding agent's system prompt runs past the 32,767 characters
  // Windows allows a whole command line, and measured on 2.1.280 the file is
  // read with the same authority as the flag — a 37k prompt was followed, and
  // its prefix cached between requests. `system` stays for a caller that has
  // nowhere to write one.
  if (systemPromptFile) args.push("--system-prompt-file", systemPromptFile);
  else if (system) args.push("--system-prompt", system);
  // Carries CLAUDE_CODE_EXTRA_BODY into the child, which is how temperature, a
  // token ceiling and stop sequences reach the upstream request at all.
  if (settingsFile) args.push("--settings", settingsFile);
  // The caller's tools, behind the inert MCP server. Omitted entirely when the
  // request has none, so a plain chat spawns no extra process.
  if (mcpConfigFile) args.push("--mcp-config", mcpConfigFile);
  // `response_format`, in the CLI's own terms. The answer then comes back
  // through a tool of the CLI's rather than as text — see translateClaudeCliEvent.
  // One argv element, never a shell string (buildSpawnPlan), so its content
  // cannot introduce a second argument.
  if (jsonSchema) args.push("--json-schema", jsonSchema);
  return args;
}

/**
 * The child gets only what it needs to run. Copying process.env would hand every
 * routed request's subprocess the server's JWT_SECRET, API_KEY_SECRET and every
 * stored provider key; the CLAUDE_CODE* nesting markers are excluded by omission,
 * which is also what stops Claude Code refusing to run inside another session.
 */
function buildChildEnv(env = process.env, account = {}) {
  const child = {};
  for (const key of CLAUDE_CLI_ENV_ALLOWLIST) {
    if (env[key] !== undefined) child[key] = env[key];
  }
  Object.assign(child, CLAUDE_CLI_CHILD_ENV);
  // Two ways to pin which account runs the request:
  //   configDir   — a Claude Code config directory, written by an interactive
  //                 /login. The natural choice on a desktop.
  //   oauthToken  — a long-lived token from `claude setup-token`. The only
  //                 choice in a container, where there is no terminal to sign
  //                 in with. It overrides whatever the directory has stored.
  const configDir = typeof account?.configDir === "string" ? account.configDir.trim() : "";
  const oauthToken = typeof account?.oauthToken === "string" ? account.oauthToken.trim() : "";
  // A pinned account replaces the host's login rather than sitting beside it.
  // Both names are on the allowlist, so a server holding one in its own
  // environment was handing it to every child — and since a token overrides a
  // directory, an account attached by directory silently ran as the host's:
  // wrong subscription billed, wrong quota card, and the connection the
  // operator attached never used at all. With no account pinned the host's own
  // login is still the right one to use.
  if (configDir || oauthToken) {
    delete child.CLAUDE_CONFIG_DIR;
    delete child.CLAUDE_CODE_OAUTH_TOKEN;
  }
  if (configDir) child.CLAUDE_CONFIG_DIR = configDir;
  if (oauthToken) child.CLAUDE_CODE_OAUTH_TOKEN = oauthToken;
  return child;
}

export const __testables = { buildChildEnv };

// ─── stream-json → OpenAI chunks ─────────────────────────────────────────────

const FINISH_REASONS = {
  max_tokens: "length",
  end_turn: "stop",
  stop_sequence: "stop",
  tool_use: "tool_calls",
  // Both are ordinary ends of a turn as far as an OpenAI client is concerned:
  // the model declined, or the API paused a long-running turn. Left unmapped
  // they fell through to "stop" anyway — named so the next reader can see that
  // is deliberate rather than an omission.
  refusal: "stop",
  pause_turn: "stop",
};

function usagePayload(usage) {
  if (!usage) return undefined;
  const promptTokens = (usage.input_tokens || 0)
    + (usage.cache_creation_input_tokens || 0)
    + (usage.cache_read_input_tokens || 0);
  const completionTokens = usage.output_tokens || 0;
  // Summed into prompt_tokens for compatibility, and also named, because a sum
  // alone hides whether the prompt cache hit at all — which is the one thing
  // worth knowing about a long conversation on this provider. The names are
  // the ones openai-to-claude.js already reads back into cache_read/creation.
  const details = {};
  if (Number.isFinite(usage.cache_read_input_tokens)) details.cached_tokens = usage.cache_read_input_tokens;
  if (Number.isFinite(usage.cache_creation_input_tokens)) details.cache_creation_tokens = usage.cache_creation_input_tokens;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    ...(Object.keys(details).length ? { prompt_tokens_details: details } : {}),
  };
}

/** One log-friendly line of what the prompt cache did for a turn. */
export function cacheUsageSummary(usage) {
  if (!usage) return null;
  return {
    input: usage.input_tokens || 0,
    cacheRead: usage.cache_read_input_tokens || 0,
    cacheCreate: usage.cache_creation_input_tokens || 0,
  };
}

/**
 * The per-request state translateClaudeCliEvent threads through one stream.
 *
 * Exported so a test drives the translator with the same state the executor
 * gives it — a hand-rolled copy would drift from the real one, and the tool
 * bookkeeping is exactly where that would go unnoticed.
 */
export function createClaudeCliContext({
  id, created, model, toolNames = null, tokenCeiling = false, structured = false,
}) {
  return {
    id,
    created,
    model,
    roleSent: false,
    stopReason: null,
    usage: null,
    // Whether this request asked for structured output (`--json-schema`). The
    // answer then arrives as the input of the CLI's own StructuredOutput tool
    // and in the result's `structured_output`, never as text: text is left
    // out, and that tool is not a call for the client to run.
    structured,
    // Whether this request asked for a bounded answer. The CLI flags a turn its
    // output ceiling cut short as an error, content and all, and that content is
    // exactly what the caller asked for — just less of it.
    tokenCeiling,
    // The CLI's name for each advertised tool → the name the caller sent. The
    // namespacing is not reversible on its own: a dot in the caller's name
    // comes back as an underscore.
    toolNames,
    // content-block index -> tool_calls index, so argument fragments land on
    // the call they belong to. Text and tool blocks share one index space.
    toolBlocks: new Map(),
    toolCount: 0,
    sawToolCall: false,
    // What has already gone out as deltas. The complete message the CLI also
    // emits repeats it, and comparing the text is what tells a repeat from a
    // block that never streamed — measured order is deltas first, then the
    // complete block, but a flag alone would also drop a second block that
    // only ever appeared in the complete form.
    streamedText: "",
    toolIdsSeen: new Set(),
    // Whether the CLI is sending partial messages at all. It is asked to, so
    // in practice every block arrives twice; a block with no id can only be
    // told apart from the streamed copy of itself by this.
    sawStreamEvent: false,
    // Whether anything the client can act on has gone out. Distinct from
    // roleSent, which thinking also sets: a turn that produced only thinking
    // has opened a message and said nothing, and that is the shape an agent
    // cannot make progress on.
    sentAnswer: false,
  };
}

/**
 * An error the client can actually see.
 *
 * A choice-less `{error: ...}` frame is the OpenAI convention, and an
 * OpenAI-format client reads it. It is also dropped whole on the way to a
 * Claude- or Gemini-format client: `openaiToClaudeResponse` returns null for
 * any chunk without `choices[0]`, so for those clients the stream simply
 * ended — no content, no finish_reason, nothing said. An agent reads that as an
 * empty turn and tries the same step again, which is what "it just loops"
 * looks like from outside. So the message also goes out as ordinary content,
 * followed by a finish that every format carries.
 *
 * `status` is for a failure that belongs to the request rather than the
 * account. A non-streaming client gets the error back as an HTTP response whose
 * status is read from this frame (sseToJsonHandler), and the account loop locks
 * and fails over on it: with none the status is 502, which costs the account 30
 * seconds for a schema it was never at fault for. Omitted, nothing changes.
 */
export function errorFrames(ctx, message, code, status) {
  const text = `[9Router] ${message}`;
  const frames = [sseChunk({
    error: { message: String(message), type: "claude_cli_error", code, ...(status ? { status } : {}) },
  })];
  const delta = ctx.roleSent ? { content: `\n${text}` } : { role: "assistant", content: text };
  ctx.roleSent = true;
  const chunkFor = (d, finishReason = null) => chatChunkSse({
    id: ctx.id, created: ctx.created, model: ctx.model, delta: d, finishReason,
  });
  frames.push(chunkFor(delta));
  frames.push(chunkFor({}, "stop"));
  return frames;
}

/**
 * The JSON text a structured turn answered with, or null when it gave none.
 *
 * `structured_output` is the CLI's own copy of what the model passed to its
 * StructuredOutput tool, after validation — the only thing here that has been
 * checked against the caller's schema. `result` is not taken even when it parses:
 * it is also what the model writes if it never calls the tool.
 */
function structuredAnswer(event) {
  const output = event.structured_output;
  return output !== undefined && output !== null ? JSON.stringify(output) : null;
}

/**
 * Translate one `claude --output-format stream-json` line into OpenAI SSE frames.
 * Returns `{ frames, finished }`; never throws — an unknown line yields nothing.
 */
export function translateClaudeCliEvent(event, ctx) {
  const frames = [];
  const chunk = (delta, finishReason = null) =>
    frames.push(chatChunkSse({ id: ctx.id, created: ctx.created, model: ctx.model, delta, finishReason }));

  if (event?.type === "stream_event") {
    ctx.sawStreamEvent = true;
    const inner = event.event;
    if (inner?.type === "content_block_start" && inner.content_block?.type === "tool_use") {
      // The CLI's own channel for a structured answer, not a call the client
      // could run or even knows the name of. Its input is delivered from the
      // result below, once the CLI has validated it against the schema —
      // streaming the fragments would hand over JSON that may still be refused.
      if (ctx.structured && inner.content_block.name === CLAUDE_CLI_STRUCTURED_OUTPUT_TOOL) {
        return { frames, finished: false };
      }
      // The model proposes, the client executes. Opening the call as soon as
      // the block starts — rather than waiting for the whole thing — is what
      // every other provider does, and it lets the client read the name while
      // the arguments are still arriving.
      const block = inner.content_block;
      const index = ctx.toolCount++;
      ctx.toolBlocks.set(inner.index, index);
      ctx.sawToolCall = true;
      if (block.id) ctx.toolIdsSeen.add(block.id);
      const call = {
        index,
        id: block.id || `call_${index}`,
        type: "function",
        // The CLI namespaces every MCP tool; the client only knows the name it
        // sent, so it gets that one back.
        function: { name: callerToolName(block.name, ctx.toolNames), arguments: "" },
      };
      ctx.sentAnswer = true;
      if (!ctx.roleSent) { ctx.roleSent = true; chunk({ role: "assistant", tool_calls: [call] }); }
      else chunk({ tool_calls: [call] });
    } else if (inner?.type === "content_block_delta") {
      const delta = inner.delta || {};
      // Not in a structured turn: the caller asked for JSON and nothing else, so
      // whatever the model says around the call is not part of the answer.
      if (delta.type === "text_delta" && delta.text && !ctx.structured) {
        ctx.streamedText += delta.text;
        ctx.sentAnswer = true;
        if (!ctx.roleSent) { ctx.roleSent = true; chunk({ role: "assistant", content: delta.text }); }
        else chunk({ content: delta.text });
      } else if (delta.type === "thinking_delta" && delta.thinking) {
        if (!ctx.roleSent) { ctx.roleSent = true; chunk({ role: "assistant", reasoning_content: delta.thinking }); }
        else chunk({ reasoning_content: delta.thinking });
      } else if (delta.type === "input_json_delta" && delta.partial_json) {
        // Arguments arrive as JSON fragments that only parse once joined, which
        // is exactly the shape an OpenAI client already reassembles.
        const index = ctx.toolBlocks.get(inner.index);
        if (index !== undefined) {
          chunk({ tool_calls: [{ index, function: { arguments: delta.partial_json } }] });
        }
      }
    } else if (inner?.type === "message_delta") {
      if (inner.delta?.stop_reason) ctx.stopReason = inner.delta.stop_reason;
      if (inner.usage) ctx.usage = { ...ctx.usage, ...inner.usage };
    } else if (inner?.type === "message_start") {
      // Per message, not per request: the complete message is compared against
      // what streamed, and a buffer that carried every earlier turn's text
      // would suppress a later block that merely repeats a phrase — which for
      // a short block ("Okay.", ".", a newline) is close to certain.
      ctx.streamedText = "";
      // Content-block indices restart at 0 with each message, so a mapping left
      // over from the last one would route this message's argument fragments
      // onto the previous message's call. Not reachable while tools pin the
      // turn limit to 1, but that pinning is a decision made elsewhere.
      ctx.toolBlocks.clear();
      if (inner.message?.usage) ctx.usage = { ...ctx.usage, ...inner.message.usage };
    }
    return { frames, finished: false };
  }

  // The complete message, which the CLI emits alongside the partial ones.
  // Everything in it has normally already gone out as deltas, and each block is
  // skipped when it has — so this adds nothing to an ordinary stream. It exists
  // for the case where the deltas do not arrive: the response then carried
  // output tokens and no content at all, which reaches a client as an assistant
  // turn with nothing in it and nothing to do, and an agent that keeps trying.
  if (event?.type === "assistant") {
    const blocks = Array.isArray(event.message?.content) ? event.message.content : [];
    for (const block of blocks) {
      // Same two rules as the streamed form above: no prose in a structured
      // turn, and the CLI's own StructuredOutput call is not the client's.
      if (ctx.structured && block?.type === "text") continue;
      if (ctx.structured && block?.type === "tool_use" && block.name === CLAUDE_CLI_STRUCTURED_OUTPUT_TOOL) continue;
      if (block?.type === "text" && block.text && !ctx.streamedText.includes(block.text)) {
        ctx.sentAnswer = true;
        if (!ctx.roleSent) { ctx.roleSent = true; chunk({ role: "assistant", content: block.text }); }
        else chunk({ content: block.text });
      } else if (block?.type === "tool_use") {
        // Keyed on the id when there is one, and on what the call would do when
        // there is not — requiring an id here dropped such a call in silence,
        // while the streamed path made one up. A dropped call is a client
        // waiting for something that never arrives.
        //
        // An id-less block is only new when nothing streamed: the streamed
        // copy of it was sent under a made-up id that cannot be matched here,
        // and sending it twice would have the client run the tool twice.
        if (!block.id && ctx.sawStreamEvent) continue;
        const key = block.id || `${block.name}:${JSON.stringify(block.input ?? {})}`;
        if (ctx.toolIdsSeen.has(key)) continue;
        ctx.toolIdsSeen.add(key);
        ctx.sawToolCall = true;
        const call = {
          index: ctx.toolCount,
          id: block.id || `call_${ctx.toolCount}`,
          type: "function",
          function: {
            name: callerToolName(block.name, ctx.toolNames),
            // Already whole here, unlike the fragments a delta carries.
            arguments: JSON.stringify(block.input ?? {}),
          },
        };
        ctx.toolCount += 1;
        ctx.sentAnswer = true;
        if (!ctx.roleSent) { ctx.roleSent = true; chunk({ role: "assistant", tool_calls: [call] }); }
        else chunk({ tool_calls: [call] });
      }
    }
    return { frames, finished: false };
  }

  if (event?.type === "result") {
    // Replaying history produces one of these per historical frame. A
    // `shouldQuery: false` turn is accepted without calling the model, and the
    // CLI reports that as a result with num_turns 0 and nothing in it. Only the
    // query's own result ends the stream — taking an acknowledgment for the end
    // would close the response before a single token arrived, which is exactly
    // what "the output stops" looks like from outside.
    // An error is never an acknowledgment, whatever its turn count says: the
    // CLI reports a startup failure with no turns at all, and swallowing that
    // leaves the request to end as a bare "exited before completing".
    if (event.num_turns === 0 && event.is_error !== true) return { frames, finished: false };
    if (!ctx.stopReason && event.stop_reason) ctx.stopReason = event.stop_reason;
    // A turn that ends by proposing a tool call always trips --max-turns: the
    // CLI is holding an unanswered call with no turn left to answer it, so it
    // reports subtype "error_max_turns" with is_error true. That is the agent
    // loop's verdict, not the completion's — the call itself is complete, and
    // running it belongs to the client that supplied the tool. Reading it as a
    // failure is what cut the stream off mid-answer for every tool-using
    // client.
    const proposedToolCall = ctx.sawToolCall && event.stop_reason === "tool_use";
    // Reaching the caller's token ceiling is a completion that stopped early,
    // which is what the API itself reports as stop_reason "max_tokens". The CLI
    // calls it an error instead — it is an agent that ran out of room — and
    // handing that on would turn an ordinary bounded request into a failure,
    // for a field every Anthropic client is required to send.
    // An error result carries its reason in `errors`, not in `result` — only
    // the success variant has a `result` at all. Reading just `result` handed
    // every CLI failure to the client as "Claude CLI returned <subtype>" with
    // the cause thrown away.
    const errorText = Array.isArray(event.errors) ? event.errors.filter(Boolean).join("; ") : "";
    const hitTokenCeiling = event.is_error === true
      && /exceeded the [0-9]+ output token maximum/i.test(`${event.result || ""} ${errorText}`);
    if (hitTokenCeiling) ctx.stopReason = "max_tokens";
    // The other shape a ceiling takes. Measured on 2.1.281: with
    // CLAUDE_CODE_MAX_OUTPUT_TOKENS set low, a bound turn comes back
    // `is_error: true` with `stop_reason: "stop_sequence"` — and with its
    // content intact. That content is what the caller asked for, only shorter,
    // so reading it as a failure threw away the answer to a request that was
    // answered. Only when this request set a ceiling: a caller's own stop
    // sequence produces the same stop_reason and is an ordinary end.
    const ceilingCutItShort = ctx.tokenCeiling
      && event.is_error === true
      && event.stop_reason === "stop_sequence";
    if (ceilingCutItShort) ctx.stopReason = "max_tokens";
    // `is_error` can otherwise ride along with subtype "success" (e.g. an
    // upstream 529 the CLI surfaced as its final text). Delivering that as
    // assistant content would hand the client a successful completion whose
    // body is an error message.
    if (!proposedToolCall && !hitTokenCeiling && !ceilingCutItShort
      && (event.subtype !== "success" || event.is_error === true)) {
      const message = event.error || errorText || event.startup_failure_reason
        || event.result || `Claude CLI returned ${event.subtype}`;
      const code = event.subtype !== "success" ? event.subtype : "upstream_error";
      // A structured turn the CLI could not get valid output from failed on this
      // request's own schema and prompt, not on the account — see
      // CLAUDE_CLI_STRUCTURED_FAILURE_STATUS for what a 502 would have cost.
      // A failure the CLI itself reports as a 429 stays a 429 whatever its wording:
      // the account loop backs off exponentially on that, where an unmarked failure
      // is a 502 and is retried every 30 seconds. (The out-of-quota wording that is
      // recognised is handled before this, with its reset; this is the net under it.)
      const status = ctx.structured && CLAUDE_CLI_STRUCTURED_FAILURE_SUBTYPES.includes(event.subtype)
        ? CLAUDE_CLI_STRUCTURED_FAILURE_STATUS
        : (event.api_error_status === 429 ? 429 : undefined);
      frames.push(...errorFrames(ctx, message, code, status));
      return { frames, finished: true };
    }
    if (event.usage) ctx.usage = { ...ctx.usage, ...event.usage };
    // A structured turn is answered from the validated output or not at all.
    // Falling back to `result` the way a plain turn does would hand a caller who
    // asked for JSON whatever the model wrote instead, as though it were the
    // JSON: only structured_output has been through the CLI's validation.
    if (ctx.structured) {
      const answer = structuredAnswer(event);
      if (answer === null) {
        const cutShort = hitTokenCeiling || ceilingCutItShort;
        frames.push(...errorFrames(
          ctx,
          "Claude CLI finished without returning the structured output that was asked for"
            + (cutShort ? ": the answer was cut short by max_tokens, so the JSON is incomplete — raise it." : "."),
          "structured_output_missing",
          CLAUDE_CLI_STRUCTURED_FAILURE_STATUS,
        ));
        return { frames, finished: true };
      }
      // Delivered whole, so it finishes as a completed answer whatever the turn
      // reported. The turn ends on the CLI's own tool_use (stop_reason
      // "tool_use", is_error false — measured on 2.1.285), and a ceiling the CLI
      // flagged leaves a validated output no less complete. A client shown
      // "tool_calls" or "length" would reject a correct answer.
      ctx.stopReason = "end_turn";
      ctx.sentAnswer = true;
      if (!ctx.roleSent) { ctx.roleSent = true; chunk({ role: "assistant", content: answer }); }
      else chunk({ content: answer });
    }
    // A non-streaming fallback: emit the final text if no delta ever arrived.
    // Not when the ceiling was hit: `result` is the CLI's error text there, and
    // handing that to the caller as the assistant's answer is worse than an
    // empty one that says why it stopped.
    // Keyed on whether an answer went out, not on whether a message was opened.
    // Thinking opens one and answers nothing, and a turn that ends there used
    // to reach the client empty — which is an agent with nothing to act on, and
    // the reason one kept retrying the same step.
    if (!ctx.structured && !hitTokenCeiling && !ctx.sentAnswer && typeof event.result === "string" && event.result) {
      ctx.sentAnswer = true;
      if (!ctx.roleSent) { ctx.roleSent = true; chunk({ role: "assistant", content: event.result }); }
      else chunk({ content: event.result });
    }
    // A turn that produced nothing at all: no delta, no tool call, and a result
    // whose text is empty — measured on a turn that only thought. Handing that
    // on as a successful, empty assistant message is the shape an agent retries
    // on forever, so it is reported as what it is.
    //
    // Only for a turn that ended of its own accord. Every other stop reason —
    // a token ceiling, a proposed call, a stop sequence, a refusal — already
    // says on the finish chunk why there is nothing, and that is an answer.
    const endedOnItsOwn = !ctx.stopReason || ctx.stopReason === "end_turn";
    if (!hitTokenCeiling && !ceilingCutItShort && !proposedToolCall && !ctx.sentAnswer && endedOnItsOwn) {
      frames.push(...errorFrames(
        ctx,
        "Claude CLI ended the turn without producing any content.",
        "empty_response",
      ));
      return { frames, finished: true };
    }
    const usage = usagePayload(ctx.usage);
    frames.push(sseChunk({
      id: ctx.id,
      object: "chat.completion.chunk",
      created: ctx.created,
      model: ctx.model,
      choices: [{ index: 0, delta: {}, finish_reason: FINISH_REASONS[ctx.stopReason] || "stop" }],
      ...(usage ? { usage } : {}),
    }));
    return { frames, finished: true };
  }

  return { frames, finished: false };
}

/**
 * Write what this request needs the CLI to read from disk.
 *
 * The system prompt, because a coding agent's runs to tens of thousands of
 * characters and Windows caps a command line at 32,767. The generation fields,
 * because the CLI has no flags for them and reads them from a settings file.
 * And the tool inventory, with the MCP server that serves it.
 *
 * Per request, in its own directory: two requests advertise different tools and
 * the CLI starts the server when it feels like it, so a shared path would let a
 * late start pick up another request's inventory.
 *
 * Returns null when there is genuinely nothing to write, or when writing fails
 * — the caller then puts the system prompt back on argv rather than dropping
 * it.
 */
function writeRequestFiles({ manifest, system, extraBody, log }) {
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-claude-req-"));
    const files = { dir };
    if (system) {
      files.systemPath = path.join(dir, "system.md");
      fs.writeFileSync(files.systemPath, system);
    }
    if (extraBody) {
      // The CLI reads env out of a settings file and applies it inside its own
      // process, which is how a body this large gets past the per-argument and
      // per-environment-string limits an exec would impose.
      files.settingsPath = path.join(dir, "settings.json");
      fs.writeFileSync(files.settingsPath, JSON.stringify({
        env: { CLAUDE_CODE_EXTRA_BODY: JSON.stringify(extraBody) },
      }));
    }
    if (manifest?.length) {
      // .cjs so the extension decides the module kind: a temp directory has no
      // package.json to consult, and the generated program is a plain script.
      const serverPath = path.join(dir, "inert-mcp.cjs");
      files.configPath = path.join(dir, "mcp.json");
      fs.writeFileSync(serverPath, inertMcpServerSource(manifest));
      fs.writeFileSync(files.configPath, JSON.stringify(
        mcpConfigDocument(process.execPath, serverPath),
      ));
    }
    return files;
  } catch (e) {
    // Losing the tools is bad; failing the request over a temp file is worse.
    // The caller then gets a plain answer instead of a tool call — which is
    // indistinguishable, from the outside, from a model that chose not to call
    // one, so say plainly that this is why.
    log?.info?.("CLAUDE-CLI",
      `request files could not be written (${e.message}); `
      + "the caller's tools are not advertised for this request");
    return null;
  }
}

/**
 * Stop the interpreter and everything it started.
 *
 * `child.kill()` signals one process. Claude Code spawns its own children —
 * the MCP server here, and on Windows the npm shim is cmd.exe wrapping node —
 * and those keep the request's pipes open after the parent is gone, so a
 * cancelled request would linger and hold its gate slot. Kill the tree.
 */
function killClaudeCliTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/F", "/T", "/PID", String(child.pid)], { stdio: "ignore" })
        .on("error", () => { try { child.kill("SIGKILL"); } catch { /* already gone */ } });
      return;
    }
    // Spawned detached, so the child leads its own group: the negated pid
    // reaches every descendant in one call.
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
  }
}

// One gate per server process (survives Next.js module reloads).
const spawnGate = (globalThis.__claudeCliGate ??= createConcurrencyGate({
  limit: () => resolveClaudeCliMaxConcurrency(),
  queueTimeoutMs: CLAUDE_CLI_QUEUE_TIMEOUT_MS,
}));

export function claudeCliGateStats() {
  return spawnGate.stats();
}

/**
 * Failure detected before any byte was streamed. It gets a real HTTP status, not
 * a 200 with an error frame: chat.js drives account/combo fallback off
 * `result.status`, and a 200 also disappears entirely for Claude- and
 * Gemini-format clients, whose translators drop choice-less frames.
 */
/**
 * Whether this request continues a session this process started, and how to
 * run it either way (see claudeCliSessions.js for why this is what keeps the
 * prompt cache alive).
 *
 * null when the session cache is off or the request cannot take part: a
 * flattened prompt has no turns to resume, and a conversation that does not
 * end on something to answer has nothing to continue.
 *
 * A hit resumes the session with the newest turn alone; a miss runs the whole
 * conversation exactly as before, only under a session id, so that the turn
 * after it can hit.
 */
async function planClaudeCliSession({ invocation, messages, model, account, log }) {
  if (!sessionCacheEnabled() || !invocation.replayed || !invocation.frames?.length) return null;
  const split = splitQueryFrame(messages);
  if (!split || !split.query.length) return null;

  const registry = sharedSessionRegistry();
  if (registry.disabled) return null;
  const configDir = sessionConfigDir(account);
  registry.sweepOrphans(configDir);
  // The host's own login has no key of its own; its config directory is one.
  const accountKey = rateLimitAccountKey(account) || `host:${configDir}`;
  const keyParts = { accountKey, model, system: invocation.system, manifest: invocation.manifest };
  const systemHash = crypto.createHash("sha256").update(String(invocation.system ?? "")).digest("hex");
  const argsFor = (ids) => buildClaudeCliArgs({
    model, maxTurns: CLAUDE_CLI_DEFAULT_MAX_TURNS, streamJsonInput: true, ...ids,
  });

  const fresh = () => {
    const sessionId = crypto.randomUUID();
    // Beneath resolveSpawnCwd(): private to this process, and the mark the
    // cleanup looks for in the CLI's encoded project directory.
    const cwd = path.join(resolveSpawnCwd(), "sessions", sessionId);
    fs.mkdirSync(cwd, { recursive: true });
    const entry = registry.begin({ sessionId, cwd, configDir, accountKey });
    // The history the client sent, written as the transcript the CLI will
    // resume, so it reaches the model in order rather than folded into the
    // newest turn (transcriptSeed). The newest turn alone goes on stdin. When
    // the conversation cannot be seeded — a tool result is the query — it
    // runs as today: every frame on stdin, under a fresh session id.
    const seed = transcriptSeed(invocation.frames);
    if (seed) {
      const projectDir = sessionProjectDir(configDir, cwd);
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(path.join(projectDir, `${sessionId}.jsonl`), transcriptRecords(seed.seed, { sessionId, cwd: fs.realpathSync(cwd) }));
      return { mode: "seeded", entry, args: argsFor({ resumeId: sessionId }), stdin: framesToStdin([seed.query]) };
    }
    return { mode: "new", entry, args: argsFor({ sessionId }), stdin: invocation.stdin };
  };

  let run;
  // A tool result answers a call the CLI has already answered for itself in
  // the transcript (see resultOk); it can only be replayed, never resumed.
  const queryIsToolResult = split.query.some((m) => m?.role === "tool" || m?.role === "function");
  let found = queryIsToolResult ? null : registry.take(sessionCacheKey({ ...keyParts, messages: split.history }));
  if (found?.ready) {
    // The previous turn's interpreter may still be exiting. Bounded: a child
    // that never exits must not hold this request, and a session read while
    // its writer runs is still a session the CLI can resume.
    // Long enough for settleChild to have killed a child that would not go;
    // if it still has not, two writers on one transcript is worse than a miss.
    const exitedInTime = await Promise.race([
      found.ready.then(() => true),
      new Promise((r) => { const t = setTimeout(() => r(false), CLAUDE_CLI_EXIT_GRACE_MS * 2 + 1000); if (t.unref) t.unref(); }),
    ]);
    if (!exitedInTime || !sessionFileExists(found)) {
      registry.discard(found);
      found = null;
    }
  }
  if (found) {
    // A resume must run where the session was written: the CLI files sessions
    // by working directory.
    try {
      fs.mkdirSync(found.cwd, { recursive: true });
    } catch (e) {
      registry.discard(found);
      throw e;
    }
    run = {
      mode: "resumed",
      entry: found,
      args: argsFor({ resumeId: found.sessionId }),
      // Only the newest turn. The rest is in the session, as the CLI itself
      // recorded it — which is the whole point.
      stdin: framesToStdin([invocation.frames.at(-1)]),
    };
  } else {
    if (split.history.length
      && registry.systemChanged(conversationKey({ accountKey, model, messages: split.history }), systemHash)) {
      // The commonest reason a conversation that should continue does not: a
      // client that stamps the time, or anything else per-request, into its
      // system prompt. Nothing here can fix that; saying so is the help.
      log?.info?.("CLAUDE-CLI", "session: system-changed — same conversation, different system prompt; a new session starts");
    }
    run = fresh();
  }

  const session = {
    ...run,
    registry,
    /**
     * The session to resume was gone after all — or the transcript this
     * process seeded was refused: start one with the whole conversation on
     * stdin, the way it has always run.
     */
    restartFresh() {
      registry.discard(session.entry);
      const sessionId = crypto.randomUUID();
      const cwd = path.join(resolveSpawnCwd(), "sessions", sessionId);
      fs.mkdirSync(cwd, { recursive: true });
      const entry = registry.begin({ sessionId, cwd, configDir, accountKey });
      Object.assign(session, { mode: "fallback", entry, args: argsFor({ sessionId }), stdin: invocation.stdin });
      return session;
    },
    /** The turn completed: continue under the conversation as the client will send it next. */
    remember(answer, promptTokens, ready) {
      const next = [...split.history, ...split.query, answer];
      registry.remember(
        sessionCacheKey({ ...keyParts, messages: next }),
        { ...session.entry, promptTokens },
        { conversation: conversationKey({ accountKey, model, messages: next }), systemHash, ready },
      );
    },
  };
  return session;
}

function errorResponse(message, code, status = 503, extra = null) {
  const body = sseChunk({ error: { message, type: "claude_cli_error", code, ...(extra || {}) } }) + SSE_DONE;
  return new Response(body, { status, headers: SSE_HEADERS });
}

/**
 * What a client is told when the account is out of quota. A 429 with the reset
 * time: chatCore reads the time through parseError below, markAccountUnavailable
 * locks the model on that account until then, and a combo goes on to its next
 * model — which a 200 carrying the CLI's own "You've hit your limit" line never
 * made it do.
 */
function quotaExhaustedResponse(untilMs) {
  return errorResponse(
    `Claude Code CLI account is out of quota; it is not asked again until ${new Date(untilMs).toISOString()}`,
    "quota_exhausted",
    429,
    { resetsAtMs: untilMs },
  );
}

// ─── ClaudeCliExecutor ───────────────────────────────────────────────────────

export class ClaudeCliExecutor extends BaseExecutor {
  constructor() {
    super("claude-cli", { id: "claude-cli", baseUrl: CLAUDE_CLI_BASE_URL, noAuth: true });
  }

  buildUrl() {
    return CLAUDE_CLI_BASE_URL;
  }

  buildHeaders() {
    return {};
  }

  transformRequest() {
    return null;
  }

  /** The reset time of a quota_exhausted response, for the account lock. */
  parseError(response, bodyText) {
    const frame = String(bodyText || "").split("\n").find((line) => line.startsWith("data: {"));
    if (!frame) return null;
    let error;
    try { error = JSON.parse(frame.slice(6)).error; } catch { return null; }
    if (error?.code !== "quota_exhausted") return null;
    return { status: response.status, message: error.message, resetsAtMs: error.resetsAtMs };
  }

  async execute({ model, body, credentials, signal, log }) {
    const b = body ?? {};
    const messages = Array.isArray(b.messages) ? b.messages : Array.isArray(b.input) ? b.input : [];
    const bin = resolveClaudeBin();

    if (!resolveClaudeCliModel(model)) {
      return { response: errorResponse(`Unsupported model id for the Claude Code CLI: ${model}`, "invalid_model", 400) };
    }

    // An account that has said it is out of quota is not asked again until its
    // reset: nothing is spawned, and the 429 sends a combo on to its next model.
    const blockedUntil = quotaBlockedUntil(credentials?.providerSpecificData, model);
    if (blockedUntil) return { response: quotaExhaustedResponse(blockedUntil) };

    // Refused before anything is spawned: these change the shape of the answer
    // the caller promised someone else, and the CLI cannot give them. Answering
    // anyway would be answering a different question.
    const unsupported = unsupportedRequestFeature(b);
    if (unsupported) {
      return { response: errorResponse(unsupported.message, unsupported.code, 400) };
    }
    // `response_format` in the CLI's own terms, or null. Already validated by
    // unsupportedRequestFeature above, so what is left is safe to put on argv.
    const jsonSchema = structuredOutputSchema(b);
    // Carried into the child through a settings file, which is the only way the
    // CLI takes them — it has no flags for temperature or a token ceiling.
    const extraBody = generationExtraBody(b);
    // A ceiling the CLI takes only through its own environment variable; see
    // outputTokenCeiling for what it does and does not honour.
    const tokenCeiling = outputTokenCeiling(b);
    // What is left has no equivalent anywhere below the CLI. Named in the log
    // so the difference is visible when output is not what someone expected.
    const ignored = ignoredRequestFields(b);
    if (ignored.length) {
      log?.info?.("CLAUDE-CLI", `no equivalent in the CLI, ignored: ${ignored.join(", ")}`);
    }

    const invocation = planClaudeCliInvocation({
      model,
      messages,
      maxTurns: b.max_turns,
      // tool_choice "none" is honoured by not advertising them at all, which is
      // the one part of tool_choice this provider can actually implement.
      tools: toolsAreWanted(b) ? b.tools : undefined,
      jsonSchema,
    });
    const stdin = invocation.stdin;
    // A request whose messages are all system or all blank leaves nothing to
    // ask. The CLI takes it, waits on a prompt that never comes, and holds one
    // of only four spawn slots until the idle timeout three minutes later —
    // four of those and every other request queues behind them.
    if (!String(stdin).trim()) {
      return {
        response: errorResponse(
          "The request carries no message to answer: Claude Code CLI needs a user "
          + "turn, and a system prompt on its own is not one.",
          "empty_prompt",
          400,
        ),
      };
    }
    // Only the binary can make a plan invalid, so this is settled before any
    // file is written — the tool files come later, once the request is going
    // to spawn.
    const basePlan = buildSpawnPlan(bin, invocation.args);
    if (basePlan.error) {
      log?.info?.("CLAUDE-CLI", basePlan.error);
      return { response: errorResponse(basePlan.error, "unsupported_binary", 503) };
    }

    // A tool whose name the MCP inventory cannot carry is dropped rather than
    // allowed to take the whole request down with it — but silently dropping
    // it leaves the caller with prose where they expected a call, and no way
    // to tell that from a model that simply chose not to call one.
    // Said once per request rather than never: these are neutralised by the
    // allowlist, so the account that runs is the right one — but an operator who
    // set one of them is expecting something else to happen.
    const conflicts = conflictingHostAuth();
    if (conflicts.length) {
      log?.info?.("CLAUDE-CLI",
        `ignoring host ${conflicts.join(", ")}: this provider always runs the `
        + "account attached to the connection, on the Claude subscription");
    }

    const toolsAsked = toolsAreWanted(b) && Array.isArray(b.tools) ? b.tools.length : 0;
    if (toolsAsked > invocation.manifest.length) {
      log?.info?.("CLAUDE-CLI",
        `${toolsAsked - invocation.manifest.length} of ${toolsAsked} tools were not advertised: `
        + "a tool name must be 1-111 characters of letters, digits, underscore, dot or hyphen");
    }

    log?.info?.(
      "CLAUDE-CLI",
      `claude -p → model=${model}, bin=${bin}, stdinChars=${stdin.length}`
        + (invocation.manifest.length ? `, tools=${invocation.manifest.length}` : "")
        + (invocation.replayed ? `, replayed ${invocation.frameCount} turns` : ", flattened prompt")
        + (extraBody ? `, body=${Object.keys(extraBody).join("/")}` : "")
        + (jsonSchema ? `, structured output (schema ${jsonSchema.length} chars)` : "")
    );
    // Wait for a spawn slot before opening the stream, so a burst queues instead
    // of starting N interpreters at once.
    let releaseSlot;
    try {
      releaseSlot = await spawnGate.acquire(signal);
    } catch (e) {
      const stats = spawnGate.stats();
      return {
        response: errorResponse(
          e.code === "aborted"
            ? "Request aborted while queued for a Claude CLI slot"
            : `${e.message}. Raise CLI_CLAUDE_MAX_CONCURRENCY (currently ${stats.limit}) if this host can afford more.`,
          e.code || "queue_failed",
        ),
      };
    }

    // After the slot, deliberately: a request that queues out or is abandoned
    // never spawns, so it should never leave a directory behind either.
    const requestFiles = writeRequestFiles({ ...invocation, extraBody, log });
    // Decided after the slot for the same reason: a request that never runs
    // must not hold a session another request could have resumed.
    let session = null;
    try {
      // Never for a structured turn. The CLI files that turn's transcript with
      // its own StructuredOutput call and result in it, which is not what the
      // client's history says happened; resuming it later — by this request or
      // by an ordinary one that follows — would put a tool the turn never
      // declares into the conversation. It runs as a whole conversation, fresh.
      if (jsonSchema) {
        // Said, so a structured turn that reprocesses a long history is not a mystery.
        if (sessionCacheEnabled()) {
          log?.info?.("CLAUDE-CLI", "session cache skipped: a structured-output request runs as a whole conversation");
        }
      } else {
        session = await planClaudeCliSession({
          invocation, messages, model, account: credentials?.providerSpecificData || {}, log,
        });
      }
    } catch (e) {
      // A cache is never worth a failed request.
      log?.info?.("CLAUDE-CLI", `session cache unavailable (${e.message}); running without it`);
      session = null;
    }
    // Once per request, on every path that can end it.
    //
    // Retried once, because the MCP server is a grandchild: it exits when the
    // interpreter closes its stdin, which can be a moment after the "close"
    // this runs from. Windows refuses to delete a script a live process is
    // still executing, and giving up there would leak a directory per request.
    // The relay that moves the prompt-cache breakpoint. Without it the CLI marks
    // the turn it is answering, which the next request replays without the
    // per-request context the CLI added — so the cached prefix never recurs and
    // every round of an agent loop reprocesses the whole history. Measured:
    // identical input reads 40k of cache, input differing by one word reads
    // none. See claudeCliAdmission.js.
    let admission = null;
    if (session && cacheRelayEnabled()) {
      // Both on: the session cache already makes the prefix recur, and it does
      // so without touching what the CLI sends. The relay would only add a hop.
      log?.info?.("CLAUDE-CLI", "cache relay skipped: the session cache is on for this request");
    }
    if (invocation.queried && cacheRelayEnabled() && !session) {
      try {
        admission = await startAdmission({
          queried: invocation.queried,
          ...(upstreamOverride() ? { upstream: upstreamOverride() } : {}),
        });
      } catch (e) {
        // Routing straight to the API still answers; it just answers slowly.
        log?.info?.("CLAUDE-CLI", `cache relay unavailable (${e.message}); prompt caching will not apply`);
      }
    }

    let toolFilesRemoved = false;
    const cleanupToolFiles = (retry = true) => {
      if (admission) { admission.close(); admission = null; }
      if (!requestFiles || toolFilesRemoved) return;
      try {
        fs.rmSync(requestFiles.dir, { recursive: true, force: true });
        toolFilesRemoved = true;
      } catch {
        if (!retry) return;
        // Unref'd: this must never be the reason the process stays alive.
        const timer = setTimeout(() => cleanupToolFiles(false), 2000);
        if (timer.unref) timer.unref();
      }
    };
    const extraArgs = [];
    if (requestFiles?.systemPath) extraArgs.push("--system-prompt-file", requestFiles.systemPath);
    // Only when the file could not be written: dropping the system prompt would
    // hand the caller Claude Code's own agent prompt instead of theirs.
    //
    // A prompt too large for the command line (Windows caps it at 32,767) makes
    // spawn throw, and that path returns a 503 the client can see, having
    // already given back the gate slot and the request directory. So the worst
    // case here is a visible failure, not a request quietly answered without
    // the instructions it was given — which is what makes trying worthwhile.
    else if (invocation.system) extraArgs.push("--system-prompt", invocation.system);
    if (requestFiles?.settingsPath) extraArgs.push("--settings", requestFiles.settingsPath);
    if (requestFiles?.configPath) extraArgs.push("--mcp-config", requestFiles.configPath);
    const runArgs = session ? session.args : invocation.args;
    const plan = extraArgs.length || session ? buildSpawnPlan(bin, [...runArgs, ...extraArgs]) : basePlan;
    // A session runs in its own directory, where the CLI files it; everything
    // else in this request's, so nothing it writes outlives it.
    const spawnCwd = () => session?.entry.cwd || requestFiles?.dir || resolveSpawnCwd();
    if (session) {
      log?.info?.("CLAUDE-CLI", `session=${session.mode} id=${session.entry.sessionId.slice(0, 8)}`
        + (session.mode === "resumed" ? ", newest turn only"
          : session.mode === "seeded" ? `, history seeded as transcript (${invocation.frameCount - 1} turns), newest turn only`
            : ", whole conversation"));
    }

    const ctx = createClaudeCliContext({
      toolNames: toolNameMap(invocation.manifest),
      tokenCeiling: Boolean(tokenCeiling),
      structured: Boolean(jsonSchema),
      id: `chatcmpl-${Date.now().toString(36)}`,
      created: Math.floor(Date.now() / 1000),
      model,
    });

    // Spawn first and wait for the OS to accept it. Node emits "spawn" or
    // "error" (ENOENT for a missing install) before anything is streamed, so a
    // failure here can still become a real HTTP status instead of a 200 whose
    // only error signal is an SSE frame a Claude-format client would drop.
    const childEnv = {
      ...buildChildEnv(process.env, credentials?.providerSpecificData),
      // The relay when it is on; otherwise, only in a test harness, the
      // local stand-in for the API (see upstreamOverride).
      ...(admission
        ? { ANTHROPIC_BASE_URL: admission.url }
        : (upstreamOverride() ? { ANTHROPIC_BASE_URL: upstreamOverride() } : {})),
      ...(tokenCeiling ? { CLAUDE_CODE_MAX_OUTPUT_TOKENS: tokenCeiling } : {}),
    };
    // A function because a resumed session that turns out to be gone is run
    // again, fresh, inside the same request (see retryFresh below).
    const launch = async (spawnPlan, cwd) => {
      const started = spawn(spawnPlan.command, spawnPlan.args, {
        env: childEnv,
        // Never the 9Router process cwd, and never a shared temp dir — see
        // resolveSpawnCwd for why it has to be one we created.
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        // Leads its own process group, so killClaudeCliTree can reach the MCP
        // server and anything else the interpreter starts. Not on Windows,
        // where detaching would open a console window; taskkill /T walks the
        // tree there without one.
        detached: process.platform !== "win32",
        ...spawnPlan.options,
      });
      await new Promise((resolve, reject) => {
        started.once("spawn", resolve);
        started.once("error", reject);
      });
      return started;
    };
    let child;
    try {
      child = await launch(plan, spawnCwd());
    } catch (err) {
      releaseSlot();
      cleanupToolFiles();
      if (session) session.registry.discard(session.entry);
      const notFound = err?.code === "ENOENT" || /ENOENT|not found/i.test(err?.message || "");
      log?.info?.("CLAUDE-CLI", `spawn failed for ${bin}: ${err?.message}`);
      return {
        response: errorResponse(
          notFound
            ? "Claude Code CLI not found on the 9Router host. Install it (https://claude.com/claude-code) or set CLI_CLAUDE_BIN."
            : "Claude CLI could not be started on the 9Router host.",
          notFound ? "not_installed" : "spawn_failed",
          503,
        ),
      };
    }

    // One release for every path that can end this request, including the case
    // where the body is never read at all.
    let slotReleased = false;
    const freeSlot = () => {
      if (slotReleased) return;
      slotReleased = true;
      releaseSlot();
    };

    let streamTeardown = null;
    // Settled with the quota verdict as soon as the CLI has said enough to tell
    // whether it is out (see the wait before the response is returned).
    let settleQuotaGate;
    const quotaGate = new Promise((resolve) => { settleQuotaGate = resolve; });
    const sseStream = new ReadableStream({
      // Runs at construction, before anything reads the body — so the child is
      // always wired up and always reaped, even if the response is discarded.
      start(controller) {
        const encoder = new TextEncoder();
        let closed = false;
        // What the session cache needs from this turn: whether it completed,
        // and what the client was sent — the conversation it will send back.
        const recorder = createAnswerRecorder();
        let resultOk = false;
        let aborted = false;
        let resumeMissing = false;
        let retried = false;
        let sessionSettled = false;
        // Settles when the last child of this request has exited; a request
        // resuming this session waits for it.
        let markExited;
        const exited = new Promise((resolve) => { markExited = resolve; });
        const settleSession = () => {
          if (!session || sessionSettled) return;
          sessionSettled = true;
          if (resultOk && !aborted) {
            const u = ctx.usage || {};
            const prompt = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
            session.remember(recorder.message(), prompt, exited);
          } else {
            session.registry.discard(session.entry);
          }
        };
        // The consumer can cancel the body at any time (client disconnect, stall
        // handling); enqueueing into a cancelled controller throws synchronously
        // from inside a stdout listener, which would be an uncaught exception.
        const emit = (frame) => {
          if (closed) return;
          try { controller.enqueue(encoder.encode(frame)); } catch { closed = true; }
        };
        const finish = () => {
          settleQuotaGate(null);
          if (closed) return;
          closed = true;
          try { controller.enqueue(encoder.encode(SSE_DONE)); } catch { /* already torn down */ }
          try { controller.close(); } catch { /* already closed */ }
        };
        // Same shape as a failure reported by the CLI itself, so a Claude- or
        // Gemini-format client sees these too rather than a stream that ends.
        const fail = (message, code) => {
          for (const frame of errorFrames(ctx, message, code)) emit(frame);
          finish();
        };

        // The gate slot and the temp directory are given back by the `close`
        // handler, and `close` waits for the child's pipes — which the child's
        // own children can hold open after it is done. Every path that ends the
        // request goes through here so that something is still watching: the
        // child gets a moment to leave on its own, then it is made to, and if
        // even that produces no `close` the slot is given back anyway. One
        // interpreter too many is survivable; a slot that never comes back
        // wedges every later request behind a 120s queue.
        const exitTimers = [];
        const after = (ms, fn) => {
          const timer = setTimeout(fn, ms);
          if (timer.unref) timer.unref();
          exitTimers.push(timer);
        };
        const settleChild = ({ now = false } = {}) => {
          if (now) killClaudeCliTree(child);
          else after(CLAUDE_CLI_EXIT_GRACE_MS, () => killClaudeCliTree(child));
          after(CLAUDE_CLI_EXIT_GRACE_MS * 2, freeSlot);
        };

        // Exposed to cancel() below, which runs outside this closure.
        streamTeardown = () => {
          closed = true;
          if (!resultOk) aborted = true;
          // Runs after start() has finished, so the timer helpers below exist.
          clearIdleTimer();
          settleChild({ now: true });
        };

        let idleTimer = null;
        const resetIdleTimer = () => {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            aborted = true;
            fail(`Claude CLI produced no output for ${CLAUDE_CLI_IDLE_TIMEOUT_MS}ms`, "idle_timeout");
            settleChild({ now: true });
          }, CLAUDE_CLI_IDLE_TIMEOUT_MS);
          if (idleTimer.unref) idleTimer.unref();
        };
        const clearIdleTimer = () => { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } };

        const onAbort = () => {
          if (!resultOk) aborted = true;
          clearIdleTimer();
          settleChild({ now: true });
          finish();
        };
        signal?.addEventListener?.("abort", onAbort, { once: true });
        // Registering on an already-aborted signal never fires. The gate can
        // hold a request for two minutes, so aborting during the wait — a
        // client that gave up, which is the ordinary case for a queued
        // request — left the child to run to completion holding a slot.
        if (signal?.aborted) onAbort();

        // Everything that watches one child. A function because a resumed
        // session that turns out to be gone is replaced by a fresh child
        // within the same request, and that one is watched the same way.
        const attach = (c, input) => {
          // The process already started (awaited above); this only catches a late
          // runtime error on the child handle.
          let spawnFailed = false;
          c.on("error", (err) => {
            spawnFailed = true;
            clearIdleTimer();
            freeSlot();
            // No "close" follows a handle that never really started, so the
            // request's directory has to be given back from here too.
            cleanupToolFiles();
            settleSession();
            markExited();
            log?.info?.("CLAUDE-CLI", `child error: ${err.message}`);
            fail("Claude CLI failed while running on the 9Router host.", "child_error");
          });

          let stdoutBuffer = "";
          let stderrTail = "";
          let sawResult = false;

          // Runs inside a stdout listener, where a throw is an uncaught exception
          // that takes the whole server down — every other request with it — for
          // one line this version of the CLI happens to shape differently.
          const handleLine = (line) => {
            try { handleEvent(line); } catch (e) {
              log?.info?.("CLAUDE-CLI", `unreadable stream line ignored: ${e.message}`);
            }
          };

          const handleEvent = (line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed[0] !== "{") return;
            let event;
            try { event = JSON.parse(trimmed); } catch { return; }
            // The subscription's own 5h/7d windows, which the CLI reports on
            // every request. For an account whose credential the usage endpoint
            // refuses — anything from `claude setup-token` — this is the only
            // place they appear at all.
            if (event.type === "rate_limit_event") {
              recordRateLimitEvent(credentials?.providerSpecificData, event.rate_limit_info);
            }
            // The account is out of quota. Remembered so nothing more is sent to it
            // until its reset, and — while the response has not been handed on —
            // turned into a 429 (see below). Content already on its way is left.
            const outOfQuota = quotaExhaustion(event);
            if (outOfQuota) {
              const until = markQuotaExhausted(credentials?.providerSpecificData, outOfQuota.resetsAtMs, outOfQuota.scope);
              log?.info?.("CLAUDE-CLI", `account out of quota, blocked until ${new Date(until).toISOString()}`);
              settleQuotaGate({ until });
            } else if (event.type === "result" || event.type === "assistant"
              // The CLI reports its windows at the start of a turn: "allowed" means it
              // is going ahead, which is the verdict — no need to wait for the model.
              || (event.type === "rate_limit_event" && event.rate_limit_info?.status !== "rejected")
              || (event.type === "stream_event" && event.event?.type?.startsWith("content_block"))) {
              settleQuotaGate(null);
            }
            // A resume of a session that is not there. The CLI says so before any
            // model call; nothing has reached the client, so the request can
            // still be answered in full — see retryFresh.
            if ((session?.mode === "resumed" || session?.mode === "seeded") && !retried && !ctx.roleSent
              && event.type === "result" && event.is_error === true
              && /no conversation found/i.test(`${(event.errors || []).join(" ")} ${event.result || ""}`)) {
              resumeMissing = true;
              return;
            }
            const { frames, finished } = translateClaudeCliEvent(event, ctx);
            for (const frame of frames) {
              if (session) recorder.frame(frame);
              emit(frame);
            }
            if (finished && event.type === "result") {
              // Completed the way the client can continue from: an answer, a
              // proposed call, or an answer a ceiling cut short.
              // Only a turn the client actually received an answer to: an
              // empty turn is delivered as an error text the client should not
              // be continuing from.
              //
              // And never a turn that proposed a tool call. Measured on
              // 2.1.281: under --permission-mode dontAsk the CLI answers its
              // own call in the transcript with a tool_result "Permission …
              // denied", and a resumed turn carrying the client's real result
              // for that tool_use_id is dropped as a duplicate — the model is
              // asked "(no content)" and answers about the denial. The tool
              // result has to run as a fresh replay, which pairs it correctly.
              const delivered = ctx.sentAnswer && !ctx.sawToolCall;
              resultOk = delivered && (event.is_error !== true
                || ctx.stopReason === "max_tokens"
                || (ctx.tokenCeiling && event.stop_reason === "stop_sequence"));
              // Here rather than at exit: the request record is built when the
              // stream finishes, which is before the child has gone.
              const cacheNow = cacheUsageSummary(ctx.usage);
              if (invocation.shape && typeof invocation.shape === "object") {
                if (cacheNow) invocation.shape.cache = cacheNow;
                if (session) invocation.shape.session = session.mode;
              }
            }
            // Remembered as soon as the answer is whole — see registry.remember.
            if (finished && resultOk) settleSession();
            if (finished) {
              sawResult = true;
              clearIdleTimer();
              finish();
              settleChild();
            }
          };

          c.stdout.setEncoding("utf8");
          c.stdout.on("data", (data) => {
            resetIdleTimer();
            stdoutBuffer += data;
            let index;
            while ((index = stdoutBuffer.indexOf("\n")) >= 0) {
              const line = stdoutBuffer.slice(0, index);
              stdoutBuffer = stdoutBuffer.slice(index + 1);
              handleLine(line);
            }
          });

          c.stderr.setEncoding("utf8");
          c.stderr.on("data", (data) => {
            stderrTail = (stderrTail + data).slice(-2000);
          });

          c.on("close", (code) => {
            clearIdleTimer();
            if (stdoutBuffer.trim()) { handleLine(stdoutBuffer); stdoutBuffer = ""; }
            // Any resume that ended before answering and before the client saw
            // anything: the measured "no conversation found", or whatever a
            // corrupted transcript or a reworded message produces instead.
            if ((session?.mode === "resumed" || session?.mode === "seeded") && !retried && !closed && !sawResult && !ctx.roleSent) {
              if (!resumeMissing && stderrTail.trim()) log?.info?.("CLAUDE-CLI", `resume failed: ${stderrTail.trim().slice(-300)}`);
              retried = true;
              retryFresh();
              return;
            }
            // The relay never answers in the upstream's place, so a transport
            // failure reaches the child as a dropped connection and nothing else.
            // This is the only place it can be named.
            // Off by default, so this only speaks when someone turned it on.
            const relay = admission?.stats?.();
            if (relay) log?.info?.("CLAUDE-CLI", `cache relay ${JSON.stringify(relay)}`);
            // What the prompt cache did. Without this a cache that quietly stops
            // hitting — a CLI update, a client that stamps the time into its
            // system prompt — looks exactly like one that works.
            const cache = cacheUsageSummary(ctx.usage);
            if (cache) {
              recordCacheUsage(credentials?.providerSpecificData, ctx.usage);
              log?.info?.("CLAUDE-CLI",
                `cache_read=${cache.cacheRead} cache_create=${cache.cacheCreate} input=${cache.input}`
                + (session ? ` session=${session.mode}` : ""));
              // A resumed turn that read back little of what came before means
              // the prefix stopped recurring — a CLI whose policy changed, most
              // likely. One line per turn, so a run of them is visible.
              const before = session?.mode === "resumed" ? session.entry.promptTokens : 0;
              if (before && cache.cacheRead < 0.2 * before) {
                log?.info?.("CLAUDE-CLI", `cache-miss-on-resume: read ${cache.cacheRead} of a ${before}-token prefix`);
              }
            }
            for (const timer of exitTimers) clearTimeout(timer);
            exitTimers.length = 0;
            freeSlot();
            cleanupToolFiles();
            signal?.removeEventListener?.("abort", onAbort);
            settleSession();
            markExited();
            // The transcript this turn wrote has to be where the next turn will
            // look for it. Measured on 2.1.281 for macOS; a platform or CLI that
            // files it elsewhere would otherwise miss on every turn and leave a
            // transcript per turn behind, with nothing in the log.
            if (session && (session.mode === "new" || session.mode === "fallback") && resultOk && !aborted
              && !session.registry.disabled && !sessionFileExists(session.entry)) {
              const reason = `session transcript not found under ${session.entry.projectDir || session.entry.configDir}`;
              session.registry.disable(reason);
              log?.info?.("CLAUDE-CLI", `session cache disabled for this process: ${reason}. `
                + "The CLI files sessions somewhere this build does not expect; "
                + `one transcript for session ${session.entry.sessionId} remains under ${session.entry.configDir}.`);
            }
            if (closed || spawnFailed) return;
            if (!sawResult) {
              // stderr can carry config dumps and credential paths — log it, don't ship it.
              // Quoted, so text the CLI echoed from the request — a schema's own
              // keywords, say — cannot forge a line or carry escape codes into the log.
              if (stderrTail.trim()) log?.info?.("CLAUDE-CLI", `stderr: ${JSON.stringify(stderrTail.trim())}`);
              fail(`Claude CLI exited with code ${code} before completing`, "exited_early");
              return;
            }
            finish();
          });

          resetIdleTimer();
          c.stdin.on("error", () => { /* child died first — close handler reports it */ });
          c.stdin.end(input);
        };

        // The session to resume was gone (deleted, expired, another process's
        // cleanup): run the whole conversation fresh, in this request, keeping
        // the slot. Only ever before anything reached the client, and once.
        const retryFresh = () => {
          let next;
          try {
            next = session.restartFresh();
          } catch (e) {
            // Inside a `close` listener: a throw here is an uncaught exception
            // that takes the server down.
            log?.info?.("CLAUDE-CLI", `session fallback could not start (${e.message})`);
            freeSlot();
            cleanupToolFiles();
            signal?.removeEventListener?.("abort", onAbort);
            settleSession();
            markExited();
            fail("Claude CLI could not be started on the 9Router host.", "spawn_failed");
            return;
          }
          log?.info?.("CLAUDE-CLI", `session=fallback id=${next.entry.sessionId.slice(0, 8)}: `
            + "the session to resume was gone; running the whole conversation fresh");
          launch(buildSpawnPlan(bin, [...next.args, ...extraArgs]), next.entry.cwd)
            .then((started) => {
              child = started;
              // Attached even when the client already left: its close handler
              // is what gives back the slot, the request files and the abort
              // listener, exactly once. `closed` keeps anything from reaching
              // the client.
              attach(started, next.stdin);
              if (closed) settleChild({ now: true });
            })
            .catch((err) => {
              log?.info?.("CLAUDE-CLI", `spawn failed for ${bin}: ${err?.message}`);
              freeSlot();
              cleanupToolFiles();
              signal?.removeEventListener?.("abort", onAbort);
              settleSession();
              markExited();
              fail("Claude CLI could not be started on the 9Router host.", "spawn_failed");
            });
        };

        attach(child, session ? session.stdin : stdin);
      },
      // Consumer gave up on the body: stop the interpreter rather than leaking it.
      cancel() {
        if (streamTeardown) streamTeardown();
      },
    });

    // Hold the response back until the CLI has said whether it is out of quota,
    // so that the request which finds out is answered 429 rather than as a
    // stream carrying the limit message. Said at the very start of a turn, so the
    // wait is short; it is capped so a slow start never holds the response.
    const quotaTimer = setTimeout(() => settleQuotaGate(null), CLAUDE_CLI_QUOTA_PROBE_WAIT_MS);
    if (quotaTimer.unref) quotaTimer.unref();
    const quotaVerdict = await quotaGate;
    clearTimeout(quotaTimer);
    if (quotaVerdict) {
      if (streamTeardown) streamTeardown();
      return { response: quotaExhaustedResponse(quotaVerdict.until) };
    }

    return {
      response: new Response(sseStream, { status: 200, headers: SSE_HEADERS }),
      url: CLAUDE_CLI_BASE_URL,
      headers: {},
      transformedBody: {
        model,
        bin,
        stdinChars: stdin.length,
        replayedTurns: invocation.replayed ? invocation.frameCount : 0,
        ...(session ? { session: session.mode } : {}),
        conversation: invocation.shape,
      },
    };
  }
}

export default ClaudeCliExecutor;
