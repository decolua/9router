/**
 * Agent toolbelt.
 *
 * Reads/writes go through the client's `fs/*` methods when the editor
 * advertises them (it then sees unsaved buffers and tracks changes itself),
 * falling back to guarded local FS. Everything mutating is flagged
 * `needsPermission` and is approved by the caller through
 * `session/request_permission` before `run()` is ever reached.
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { resolveInRoot } = require("./guard");

const MAX_OUTPUT = 40000;
const MAX_GREP_HITS = 200;
const IGNORED_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "coverage", ".cache", "out", ".turbo"]);

const truncate = (text, max = MAX_OUTPUT) =>
  text.length > max ? `${text.slice(0, max)}\n… [truncated ${text.length - max} chars]` : text;

// ── helpers ─────────────────────────────────────────────────────────────────

async function readText(ctx, absPath, { line, limit } = {}) {
  if (ctx.clientCaps.fs?.readTextFile) {
    const params = { sessionId: ctx.session.id, path: absPath };
    if (line) params.line = line;
    if (limit) params.limit = limit;
    const res = await ctx.client.request("fs/read_text_file", params);
    return res?.content ?? "";
  }
  const raw = fs.readFileSync(absPath, "utf8");
  if (!line && !limit) return raw;
  const lines = raw.split("\n");
  const start = line ? Math.max(0, line - 1) : 0;
  const slice = limit ? lines.slice(start, start + limit) : lines.slice(start);
  return slice.join("\n");
}

async function writeText(ctx, absPath, content) {
  if (ctx.clientCaps.fs?.writeTextFile) {
    await ctx.client.request("fs/write_text_file", { sessionId: ctx.session.id, path: absPath, content });
    return;
  }
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, "utf8");
}

function walkFiles(root, { max = 5000 } = {}) {
  const out = [];
  const stack = [root];
  while (stack.length && out.length < max) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (out.length >= max) break;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!IGNORED_DIRS.has(e.name) && !e.name.startsWith(".")) stack.push(full);
      } else if (e.isFile()) {
        out.push(full);
      }
    }
  }
  return out;
}

function globToRegExp(pattern) {
  const esc = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "@@GLOBSTAR@@")
    .replace(/\*/g, "[^/]*")
    .replace(/@@GLOBSTAR@@/g, ".*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${esc}$`);
}

// Private/loopback targets are refused for the outbound web tool (SSRF): the
// gateway runs locally, so a model-driven fetch to 127.0.0.1 could otherwise
// reach internal admin routes.
function assertPublicUrl(raw) {
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http(s) URLs are allowed");
  const host = u.hostname.toLowerCase();
  const blocked =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === "::1" ||
    host.startsWith("fc") ||
    host.startsWith("fd");
  if (blocked && !process.env.NINE_ROUTER_ACP_ALLOW_LOCAL) {
    throw new Error(`Refusing to fetch a local/private address (${host}). Set NINE_ROUTER_ACP_ALLOW_LOCAL=1 to override.`);
  }
  return u;
}

async function runLocalShell(command, cwd, { signal, timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.env.SHELL || (process.platform === "win32" ? "cmd.exe" : "sh"), ["-lc", command], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const onAbort = () => {
      child.kill("SIGKILL");
      finish({ output: truncate(out), exitCode: null, signal: "ABORTED" });
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ output: truncate(out), exitCode: null, signal: "TIMEOUT" });
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      out += d;
      if (out.length > MAX_OUTPUT * 2) out = out.slice(-MAX_OUTPUT * 2);
    });
    child.stderr.on("data", (d) => {
      out += d;
      if (out.length > MAX_OUTPUT * 2) out = out.slice(-MAX_OUTPUT * 2);
    });
    child.on("error", (err) => finish({ output: truncate(`${out}\n${err.message}`), exitCode: 127, signal: null }));
    child.on("close", (code, sig) => finish({ output: truncate(out), exitCode: code, signal: sig }));
  });
}

async function runClientTerminal(ctx, command, cwd) {
  const shell = process.env.SHELL || (process.platform === "win32" ? "cmd.exe" : "sh");
  const args = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-lc", command];
  const created = await ctx.client.request("terminal/create", {
    sessionId: ctx.session.id,
    command: shell,
    args,
    cwd,
    outputByteLimit: MAX_OUTPUT,
  });
  const terminalId = created.terminalId;
  const deadline = Date.now() + 120000;
  let last = { output: "", exitStatus: null, truncated: false };
  try {
    while (Date.now() < deadline) {
      if (ctx.signal?.aborted) {
        await ctx.client.request("terminal/kill", { sessionId: ctx.session.id, terminalId }).catch(() => {});
        return { output: truncate(last.output || ""), exitCode: null, signal: "ABORTED" };
      }
      last = await ctx.client.request("terminal/output", { sessionId: ctx.session.id, terminalId });
      if (last.exitStatus) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    return {
      output: truncate(last.output || ""),
      exitCode: last.exitStatus?.exitCode ?? null,
      signal: last.exitStatus?.signal ?? null,
    };
  } finally {
    await ctx.client.request("terminal/release", { sessionId: ctx.session.id, terminalId }).catch(() => {});
  }
}

// ── tool definitions ────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "read_file",
    kind: "read",
    needsPermission: false,
    description: "Read a text file from the workspace. Optionally start at a line and read a limited number of lines.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the workspace root (or absolute inside it)" },
        line: { type: "integer", description: "1-based line to start from" },
        limit: { type: "integer", description: "Maximum number of lines to read" },
      },
      required: ["path"],
    },
    async run({ args, ctx, absPath }) {
      const content = await readText(ctx, absPath, { line: args.line, limit: args.limit });
      return { text: truncate(content || ""), locations: [{ path: absPath, line: args.line || null }] };
    },
  },
  {
    name: "write_file",
    kind: "edit",
    needsPermission: true,
    description: "Create or overwrite a file with the given content.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the workspace root" },
        content: { type: "string", description: "Full new content of the file" },
      },
      required: ["path", "content"],
    },
    async run({ args, ctx, absPath }) {
      let oldText = null;
      try {
        oldText = fs.existsSync(absPath) ? await readText(ctx, absPath) : null;
      } catch {
        oldText = null;
      }
      await writeText(ctx, absPath, args.content);
      return {
        text: `Wrote ${Buffer.byteLength(args.content)} bytes to ${args.path}`,
        diff: { path: absPath, oldText, newText: args.content },
        locations: [{ path: absPath, line: null }],
      };
    },
  },
  {
    name: "edit_file",
    kind: "edit",
    needsPermission: true,
    description: "Replace exactly one occurrence of old_str with new_str in a file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the workspace root" },
        old_str: { type: "string", description: "Exact text to replace (must occur exactly once)" },
        new_str: { type: "string", description: "Replacement text" },
      },
      required: ["path", "old_str", "new_str"],
    },
    async run({ args, ctx, absPath }) {
      const before = await readText(ctx, absPath);
      const count = before.split(args.old_str).length - 1;
      if (count === 0) throw new Error(`old_str not found in ${args.path}`);
      if (count > 1) throw new Error(`old_str occurs ${count} times in ${args.path} — make it unique`);
      const after = before.replace(args.old_str, args.new_str);
      await writeText(ctx, absPath, after);
      const line = before.slice(0, before.indexOf(args.old_str)).split("\n").length;
      return {
        text: `Edited ${args.path}`,
        diff: { path: absPath, oldText: before, newText: after },
        locations: [{ path: absPath, line }],
      };
    },
  },
  {
    name: "list_dir",
    kind: "read",
    needsPermission: false,
    description: "List the entries of a directory inside the workspace.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Directory path relative to the workspace root (default: .)" } },
      required: [],
    },
    async run({ args, ctx }) {
      const dir = resolveInRoot(ctx.session.cwd, args.path || ".");
      const entries = fs.readdirSync(dir, { withFileTypes: true }).slice(0, 500);
      const lines = entries.map((e) => {
        if (e.isDirectory()) return `${e.name}/`;
        try {
          return `${e.name} (${fs.statSync(path.join(dir, e.name)).size}B)`;
        } catch {
          return e.name;
        }
      });
      return { text: truncate(lines.join("\n") || "(empty)") };
    },
  },
  {
    name: "glob",
    kind: "search",
    needsPermission: false,
    description: "Find files by glob pattern (**, *, ?) inside the workspace.",
    parameters: {
      type: "object",
      properties: { pattern: { type: "string", description: "Glob pattern, e.g. src/**/*.test.js" } },
      required: ["pattern"],
    },
    async run({ args, ctx }) {
      const re = globToRegExp(String(args.pattern));
      const hits = walkFiles(ctx.session.cwd)
        .map((f) => path.relative(ctx.session.cwd, f))
        .filter((rel) => re.test(rel))
        .slice(0, MAX_GREP_HITS);
      return { text: hits.length ? truncate(hits.join("\n")) : "No matches" };
    },
  },
  {
    name: "grep",
    kind: "search",
    needsPermission: false,
    description: "Search file contents with a regular expression inside the workspace.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "JavaScript regular expression" },
        path: { type: "string", description: "Sub-directory to search (default: workspace root)" },
      },
      required: ["pattern"],
    },
    async run({ args, ctx }) {
      let re;
      try {
        re = new RegExp(args.pattern, "g");
      } catch (err) {
        throw new Error(`Invalid regex: ${err.message}`);
      }
      const base = resolveInRoot(ctx.session.cwd, args.path || ".");
      const hits = [];
      for (const file of walkFiles(base)) {
        if (hits.length >= MAX_GREP_HITS) break;
        let stat;
        try {
          stat = fs.statSync(file);
        } catch {
          continue;
        }
        if (stat.size > 1024 * 1024) continue;
        let text;
        try {
          const buf = fs.readFileSync(file);
          if (buf.includes(0)) continue;
          text = buf.toString("utf8");
        } catch {
          continue;
        }
        const lines = text.split("\n");
        for (let i = 0; i < lines.length && hits.length < MAX_GREP_HITS; i++) {
          re.lastIndex = 0;
          if (re.test(lines[i])) {
            hits.push(`${path.relative(ctx.session.cwd, file)}:${i + 1}:${lines[i].trim().slice(0, 300)}`);
          }
        }
      }
      return { text: hits.length ? truncate(hits.join("\n")) : "No matches" };
    },
  },
  {
    name: "bash",
    kind: "execute",
    needsPermission: true,
    description: "Run a shell command in the workspace and return its output.",
    parameters: {
      type: "object",
      properties: { command: { type: "string", description: "Shell command to run" } },
      required: ["command"],
    },
    async run({ args, ctx }) {
      const command = String(args.command || "");
      if (!command.trim()) throw new Error("command is required");
      const res = ctx.clientCaps.terminal
        ? await runClientTerminal(ctx, command, ctx.session.cwd)
        : await runLocalShell(command, ctx.session.cwd, { signal: ctx.signal });
      const head = `exit=${res.exitCode}${res.signal ? ` signal=${res.signal}` : ""}`;
      return { text: truncate(`${head}\n${res.output}`) };
    },
  },
  {
    name: "web_fetch",
    kind: "fetch",
    needsPermission: true,
    description: "Fetch a public http(s) page through the 9router gateway and return its text.",
    parameters: {
      type: "object",
      properties: { url: { type: "string", description: "Absolute http(s) URL" } },
      required: ["url"],
    },
    async run({ args, ctx }) {
      assertPublicUrl(args.url);
      const text = await ctx.gateway.webFetch(args.url, { signal: ctx.signal });
      return { text: truncate(String(text)) };
    },
  },
];

function toolDefinitions(extra = []) {
  return [...TOOLS, ...extra].map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/** Resolve a model-requested tool to a definition + guarded absolute path. */
function resolveTool(name, args, ctx, extra = []) {
  const def = [...TOOLS, ...extra].find((t) => t.name === name);
  if (!def) return null;
  let absPath = null;
  if (def.parameters?.properties?.path && args?.path) absPath = resolveInRoot(ctx.session.cwd, args.path);
  return { def, absPath };
}

module.exports = {
  TOOLS,
  toolDefinitions,
  resolveTool,
  assertPublicUrl,
  globToRegExp,
  __test__: { globToRegExp, assertPublicUrl, truncate, runLocalShell },
};
