/**
 * Claude Code sessions kept across requests, so the prompt cache survives.
 *
 * The problem, measured on 2.1.281 (docs/fable/2026-09-24-claude-cli-prompt-cache-design.md):
 * a client sends the whole conversation every turn, and replaying it through
 * `--input-format stream-json` does not rebuild the conversation the CLI had
 * the turn before. History frames sent with `shouldQuery: false` are queued
 * and folded into the next query — the assistant turn lands first, and every
 * earlier question arrives inside the newest user turn with the CLI's
 * per-request reminders in front of it. The prefix differs from the previous
 * request's at the first message, so nothing past the system prompt is ever
 * read back from cache: every round of an agent loop reprocesses its whole
 * history.
 *
 * `claude -p --resume <id>` does rebuild it — from the session file the CLI
 * wrote, reminders and all — so the request repeats the previous one byte for
 * byte through the breakpoint the CLI itself placed, and the cache hits.
 * Measured live on haiku: every resumed turn read back 100% of the previous
 * turn's prompt. No relay, no base-URL override, no change to what the CLI
 * sends: the request the CLI builds is the one Anthropic sees, which is the
 * property this provider exists for.
 *
 * What this module decides is only *whether a request continues a session this
 * process started*. A client repeats history rather than naming a session, so
 * the answer is a hash: when a turn completes, the conversation as the client
 * will next send it — what it sent, plus what it got back — is remembered
 * against the session that produced it. The next request's history, minus its
 * newest turn, either hashes to that or it does not. When it does not, the
 * request runs exactly as it always has, and starts a session of its own.
 *
 * Sessions live on disk under the account's config directory, which is the
 * cost of this: a conversation stays in `<config>/projects/` until its entry
 * expires (15 minutes by default — the cache itself lasts five) and is then
 * deleted.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CLAUDE_CLI_SESSION_TTL_MS = 15 * 60 * 1000;
export const CLAUDE_CLI_SESSION_MAX = 500;
// resolveSpawnCwd() creates `<tmp>/9router-claude-XXXXXX`, and every session's
// cwd is beneath it, so the CLI's encoded project directory for any of them
// carries this. It is what keeps cleanup away from the operator's own projects.
export const CLAUDE_CLI_SESSION_DIR_MARK = "9router-claude-";

/** Off unless asked for, like the relay; see docs/fable for the gate it passed. */
export function sessionCacheEnabled(env = process.env) {
  return String(env.CLI_CLAUDE_SESSION_CACHE ?? "0").toLowerCase() === "1";
}

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");

/**
 * The same JSON whatever order its keys were written in. Tool-call arguments
 * come back from a client re-serialised by its own SDK — spacing and key order
 * are not what the model streamed — so they are compared as values.
 */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function canonicalArguments(args) {
  if (args && typeof args === "object") return canonicalJson(args);
  const text = typeof args === "string" ? args : "";
  if (!text.trim()) return "{}";
  try { return canonicalJson(JSON.parse(text)); } catch { return text; }
}

function partsOf(content) {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? content : [];
}

/** Text and attachments of a message, in order; images by hash, never inline. */
function contentOf(content) {
  const out = [];
  for (const part of partsOf(content)) {
    if (typeof part === "string") { out.push(["t", part]); continue; }
    if (!part || typeof part !== "object") continue;
    if (typeof part.text === "string") { out.push(["t", part.text]); continue; }
    if (typeof part.input_text === "string") { out.push(["t", part.input_text]); continue; }
    const url = typeof part.image_url === "string" ? part.image_url : part.image_url?.url || part.url;
    if (typeof url === "string") { out.push(["i", sha(url)]); continue; }
    if (part.source) { out.push(["i", sha(canonicalJson(part.source))]); continue; }
  }
  // Joined, so a client that sends one string where it received parts (or the
  // reverse) is still the same turn. Trailing whitespace is not the model's
  // to keep: clients trim what they display and send back.
  const text = out.filter(([k]) => k === "t").map(([, v]) => v).join("").replace(/\s+$/, "");
  const images = out.filter(([k]) => k === "i").map(([, v]) => v);
  return images.length ? { text, images } : { text };
}

const isSystem = (m) => m?.role === "system" || m?.role === "developer";
const isToolResult = (m) => m?.role === "tool" || m?.role === "function";

/**
 * The parts of a conversation that decide whether it is the same one: role,
 * text, tool calls and their results. Everything a client may drop or rewrite
 * on the way back — reasoning, names, refusals, annotations — is left out,
 * because a key that changes when nothing the model sees has changed is a
 * cache that never hits.
 */
export function normalizeConversation(messages) {
  const out = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || isSystem(message)) continue;
    if (isToolResult(message)) {
      out.push({ r: "tool", id: String(message.tool_call_id ?? message.name ?? ""), ...contentOf(message.content) });
      continue;
    }
    const role = message.role === "assistant" ? "assistant" : "user";
    const entry = { r: role, ...contentOf(message.content) };
    if (role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length) {
      entry.calls = message.tool_calls.map((call) => ({
        id: String(call?.id ?? ""),
        name: String(call?.function?.name ?? call?.name ?? ""),
        args: canonicalArguments(call?.function?.arguments ?? call?.arguments),
      }));
    }
    // An assistant turn that said nothing and called nothing is not a turn the
    // CLI keeps; a client that echoes it back must not miss over it.
    if (role === "assistant" && !entry.text && !entry.calls && !entry.images) continue;
    out.push(entry);
  }
  return out;
}

/**
 * The request's newest turn and what came before it.
 *
 * Not `messages[:-1]`: a model that made several calls at once is answered by
 * several tool messages, and all of them are the newest turn — the replay
 * folds them into one user frame the same way (claudeCliReplay.js). Cutting
 * after the last one alone would miss every parallel tool round.
 *
 * @returns {{ history: Array<object>, query: Array<object> } | null}
 *   null when the conversation does not end on something to answer.
 */
export function splitQueryFrame(messages) {
  const turns = (Array.isArray(messages) ? messages : []).filter((m) => m && !isSystem(m));
  if (!turns.length) return null;
  const last = turns[turns.length - 1];
  let start = turns.length - 1;
  if (isToolResult(last)) {
    while (start > 0 && isToolResult(turns[start - 1])) start -= 1;
  } else if (last.role === "assistant") {
    return null;
  }
  return { history: turns.slice(0, start), query: turns.slice(start) };
}

/**
 * What a conversation is continued under. The account, because a session
 * belongs to the login that wrote it; the model, the system prompt and the
 * tools, because the cache is keyed on all of them and the CLI would resume
 * with the old ones otherwise.
 */
export function sessionCacheKey({ accountKey, model, system, manifest, messages }) {
  const tools = (Array.isArray(manifest) ? manifest : [])
    .map((t) => canonicalJson(t)).sort();
  return sha(canonicalJson({
    v: 1,
    a: String(accountKey ?? ""),
    m: String(model ?? ""),
    s: sha(String(system ?? "")),
    t: tools,
    c: normalizeConversation(messages),
  }));
}

/** The conversation alone, for telling "the system prompt changed" from "a different conversation". */
export function conversationKey({ accountKey, model, messages }) {
  return sha(canonicalJson({ v: 1, a: String(accountKey ?? ""), m: String(model ?? ""), c: normalizeConversation(messages) }));
}

/**
 * The assistant message a client will send back, rebuilt from the chunks it
 * was sent — so it is what the client actually received, not what the CLI
 * meant to say.
 */
export function createAnswerRecorder() {
  let text = "";
  const calls = new Map();
  return {
    frame(frame) {
      if (typeof frame !== "string") return;
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        let chunk;
        try { chunk = JSON.parse(line.slice(6)); } catch { continue; }
        const delta = chunk?.choices?.[0]?.delta;
        if (!delta) continue;
        if (typeof delta.content === "string") text += delta.content;
        for (const call of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
          const index = Number.isInteger(call?.index) ? call.index : calls.size;
          const entry = calls.get(index) || { id: "", name: "", arguments: "" };
          if (call.id) entry.id = call.id;
          if (call.function?.name) entry.name = call.function.name;
          if (typeof call.function?.arguments === "string") entry.arguments += call.function.arguments;
          calls.set(index, entry);
        }
      }
    },
    message() {
      const toolCalls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, c]) => ({
        id: c.id, type: "function", function: { name: c.name, arguments: c.arguments },
      }));
      return { role: "assistant", content: text, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
    },
  };
}

/** Where the CLI keeps this account's sessions: the same rule buildChildEnv applies. */
export function sessionConfigDir(account = {}, env = process.env) {
  const configDir = typeof account?.configDir === "string" ? account.configDir.trim() : "";
  if (configDir) return configDir;
  const home = env.HOME || env.USERPROFILE || os.homedir();
  const token = typeof account?.oauthToken === "string" ? account.oauthToken.trim() : "";
  // A token account runs without CLAUDE_CONFIG_DIR (buildChildEnv removes it),
  // so it lands in the home directory's default.
  if (token) return path.join(home, ".claude");
  return env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_FILE = new RegExp(`^${UUID}\\.jsonl$`);
// The encoded name of `<tmp>/9router-claude-XXXXXX/sessions/<uuid>` and
// nothing else: resolveSpawnCwd's mkdtemp suffix is exactly six characters,
// and the session cwd is always `sessions/<uuid>` beneath it. A substring
// match would also take an operator's own `~/code/9router-claude-proxy`, and
// the sweep would then delete their interactive transcripts.
const SESSION_PROJECT = new RegExp(`${CLAUDE_CLI_SESSION_DIR_MARK}[A-Za-z0-9]{6}-sessions-${UUID}$`);

/**
 * The directory the CLI files a session under: `<config>/projects/` plus the
 * session's cwd, resolved and with every non-alphanumeric turned into `-` —
 * measured on 2.1.281, where a cwd under /var/folders lands in `-private-var-folders-…`.
 */
export function sessionProjectDir(configDir, cwd, fsImpl = fs) {
  let real = path.resolve(cwd);
  try { real = fsImpl.realpathSync(cwd); } catch { /* not there yet, or gone */ }
  return path.join(configDir, "projects", real.replace(/[^A-Za-z0-9]/g, "-"));
}

function projectDirOf(entry, fsImpl) {
  if (!entry?.configDir || !entry?.cwd) return null;
  const dir = entry.projectDir || sessionProjectDir(entry.configDir, entry.cwd, fsImpl);
  // Belt and braces: only ever this provider's own shape of directory.
  return SESSION_PROJECT.test(path.basename(dir)) ? dir : null;
}

/** The session's transcript exists: `--resume` would find something. */
export function sessionFileExists(entry, fsImpl = fs) {
  const dir = projectDirOf(entry, fsImpl);
  return Boolean(dir && UUID_FILE.test(`${entry.sessionId}.jsonl`) && fsImpl.existsSync(path.join(dir, `${entry.sessionId}.jsonl`)));
}

function removeSessionFiles(entry, fsImpl) {
  const dir = projectDirOf(entry, fsImpl);
  if (dir && new RegExp(`^${UUID}$`).test(String(entry.sessionId))) {
    try { fsImpl.rmSync(path.join(dir, `${entry.sessionId}.jsonl`), { force: true }); } catch { /* gone */ }
    try { fsImpl.rmSync(path.join(dir, entry.sessionId), { recursive: true, force: true }); } catch { /* gone */ }
    try { if (!fsImpl.readdirSync(dir).length) fsImpl.rmdirSync(dir); } catch { /* not empty, or gone */ }
  }
  if (entry?.cwd) {
    try { fsImpl.rmSync(entry.cwd, { recursive: true, force: true }); } catch { /* gone */ }
  }
}

/**
 * @param {object} [opts]
 * @param {number} [opts.ttlMs] how long a finished turn can be continued
 * @param {number} [opts.max] entries kept at most; the oldest go first
 * @param {() => number} [opts.now]
 * @param {typeof fs} [opts.fsImpl] injected by tests
 */
export function createSessionRegistry({
  ttlMs = CLAUDE_CLI_SESSION_TTL_MS, max = CLAUDE_CLI_SESSION_MAX, now = Date.now, fsImpl = fs,
} = {}) {
  const byKey = new Map();          // continuation key → entry
  const byConversation = new Map(); // conversation key → { systemHash }, for diagnosis only
  const inFlight = new Set();       // session ids a request is running
  const configDirs = new Set();     // config dirs sessions have been written under
  let disabled = null;              // why this process stopped using sessions, or null

  const drop = (key) => {
    const entry = byKey.get(key);
    byKey.delete(key);
    if (entry && !inFlight.has(entry.sessionId)) removeSessionFiles(entry, fsImpl);
  };

  const registry = {
    /**
     * The session this history continues, taken for the caller — or null.
     * Taken, not read: the session moves on with this request, so the key it
     * was found under no longer describes it. A client that regenerates the
     * same turn therefore starts fresh rather than resuming past it.
     */
    take(key) {
      const entry = byKey.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= now() || inFlight.has(entry.sessionId)) return null;
      byKey.delete(key);
      if (!sessionFileExists(entry, fsImpl)) {
        removeSessionFiles(entry, fsImpl);
        return null;
      }
      inFlight.add(entry.sessionId);
      return entry;
    },

    /** A new session is being written; nothing may resume it yet. */
    begin(entry) {
      inFlight.add(entry.sessionId);
      return entry.cwd && entry.configDir && !entry.projectDir
        ? Object.assign(entry, { projectDir: sessionProjectDir(entry.configDir, entry.cwd, fsImpl) })
        : entry;
    },

    /**
     * The turn completed: the conversation as the client will next send it
     * continues this session.
     *
     * Called when the answer is complete, not when the child exits: a client
     * sends its next turn the moment it has the answer, which is routinely
     * before the interpreter has finished exiting — waiting for exit made every
     * fast client miss. `ready` settles when it has exited; a resume waits for
     * it (see planClaudeCliSession), so the session file is never read while
     * its writer is still running.
     */
    remember(key, entry, { conversation, systemHash, ready } = {}) {
      inFlight.delete(entry.sessionId);
      // Two requests that ran the same conversation at once both arrive here
      // with the same key. Only one can be continued; the other's transcript
      // would otherwise stay on disk with nothing left to expire it.
      const previous = byKey.get(key);
      if (previous && previous.sessionId !== entry.sessionId && !inFlight.has(previous.sessionId)) {
        removeSessionFiles(previous, fsImpl);
      }
      byKey.set(key, { ...entry, ready: ready || null, expiresAt: now() + ttlMs });
      if (conversation) byConversation.set(conversation, { systemHash, expiresAt: now() + ttlMs });
      while (byKey.size > max) drop(byKey.keys().next().value);
      while (byConversation.size > max) byConversation.delete(byConversation.keys().next().value);
    },

    /** The turn did not complete: nothing will continue it. */
    discard(entry) {
      inFlight.delete(entry.sessionId);
      removeSessionFiles(entry, fsImpl);
    },

    /** Why a miss missed, when it is the system prompt that moved. */
    systemChanged(conversation, systemHash) {
      const seen = byConversation.get(conversation);
      return Boolean(seen && seen.expiresAt > now() && seen.systemHash !== systemHash);
    },

    sweep() {
      const t = now();
      for (const [key, entry] of [...byKey]) if (entry.expiresAt <= t) drop(key);
      for (const [key, seen] of [...byConversation]) if (seen.expiresAt <= t) byConversation.delete(key);
      // Orphans age past the TTL between sweeps; the first look at a directory
      // skips whatever was still young, so it has to be looked at again.
      let removed = 0;
      for (const dir of configDirs) removed += sweepOrphanFiles(dir);
      return removed;
    },

    /**
     * Sessions a previous process left behind under this config directory,
     * now and on every later sweep. Only this provider's own marked
     * directories, and only files older than the TTL, so a second 9Router
     * sharing the directory keeps what it is still using.
     */
    sweepOrphans(configDir) {
      if (!configDir) return 0;
      const first = !configDirs.has(configDir);
      configDirs.add(configDir);
      return first ? sweepOrphanFiles(configDir) : 0;
    },

    /**
     * A completed session's transcript was not where this module looks for it:
     * a platform or CLI version that files sessions differently. Every turn
     * would miss, and every turn would leave a transcript nobody deletes. Stop
     * here, once, and say so — the one transcript already written is the
     * whole cost.
     */
    disable(reason) {
      if (disabled) return;
      disabled = reason;
      for (const key of [...byKey.keys()]) drop(key);
      byConversation.clear();
    },
    get disabled() { return disabled; },

    stats() {
      return { entries: byKey.size, inFlight: inFlight.size, disabled };
    },
  };

  function sweepOrphanFiles(configDir) {
      const live = new Set([...byKey.values()].map((e) => e.sessionId).concat([...inFlight]));
      let removed = 0;
      const projects = path.join(configDir, "projects");
      let dirs = [];
      try { dirs = fsImpl.readdirSync(projects).filter((n) => SESSION_PROJECT.test(n)); } catch { return 0; }
      for (const name of dirs) {
        const dir = path.join(projects, name);
        let names = [];
        try { names = fsImpl.readdirSync(dir); } catch { continue; }
        for (const file of names) {
          if (!UUID_FILE.test(file)) continue;
          const id = file.slice(0, -".jsonl".length);
          if (live.has(id)) continue;
          const full = path.join(dir, file);
          let mtime = 0;
          try { mtime = fsImpl.statSync(full).mtimeMs; } catch { continue; }
          if (now() - mtime < ttlMs) continue;
          try { fsImpl.rmSync(full, { force: true }); removed += 1; } catch { /* gone */ }
          try { fsImpl.rmSync(path.join(dir, id), { recursive: true, force: true }); } catch { /* gone */ }
        }
        try { if (!fsImpl.readdirSync(dir).length) fsImpl.rmdirSync(dir); } catch { /* not empty */ }
      }
      return removed;
  }
  return registry;
}

/** One registry per server process (survives Next.js module reloads), swept on a timer. */
export function sharedSessionRegistry(env = process.env) {
  if (!globalThis.__claudeCliSessions) {
    const registry = createSessionRegistry({
      ttlMs: positiveInt(env.CLI_CLAUDE_SESSION_TTL_MS, CLAUDE_CLI_SESSION_TTL_MS),
      max: positiveInt(env.CLI_CLAUDE_SESSION_MAX, CLAUDE_CLI_SESSION_MAX),
    });
    const timer = setInterval(() => registry.sweep(), 60 * 1000);
    if (timer.unref) timer.unref();
    globalThis.__claudeCliSessions = registry;
  }
  return globalThis.__claudeCliSessions;
}

export const __testables = { canonicalJson, canonicalArguments, contentOf, removeSessionFiles };
