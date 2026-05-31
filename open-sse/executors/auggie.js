import { spawn } from "child_process";
import { Readable } from "stream";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";

/**
 * AuggieExecutor — wraps the Augment Code "auggie" CLI as a 9Router provider.
 *
 * Auggie has no public HTTP endpoint. It is a Node CLI that talks to Augment's
 * private backend using the local session created via `auggie login`.
 * This executor spawns `auggie --print --quiet --model <model>` as a subprocess,
 * feeds it a flattened prompt built from the OpenAI-style request, and wraps
 * the captured stdout into an OpenAI chat-completion response (JSON or SSE).
 *
 * Authentication is delegated entirely to the local Auggie session
 * (`~/.augment/session.json` or AUGMENT_SESSION_AUTH env var). The 9Router
 * connection itself is `noAuth: true` from 9Router's perspective.
 */
export class AuggieExecutor extends BaseExecutor {
  constructor() {
    super("auggie", PROVIDERS.auggie || { format: "openai", noAuth: true });
    this.noAuth = true;
  }

  // Resolve the executable name. Windows uses .cmd shims for npm globals.
  getCliCommand(credentials) {
    const override = credentials?.providerSpecificData?.auggiePath?.trim();
    if (override) return override;
    return process.platform === "win32" ? "auggie.cmd" : "auggie";
  }

  // Flatten OpenAI-style messages into a single prompt string for `auggie --print`.
  buildPrompt(body) {
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const lines = [];

    for (const msg of messages) {
      const role = msg?.role || "user";
      const content = this.stringifyContent(msg?.content);
      if (!content) continue;

      if (role === "system") {
        lines.push(`[System]\n${content}`);
      } else if (role === "assistant") {
        lines.push(`[Assistant]\n${content}`);
      } else if (role === "tool") {
        lines.push(`[Tool result]\n${content}`);
      } else {
        lines.push(`[User]\n${content}`);
      }
    }

    return lines.join("\n\n");
  }

  // OpenAI/Claude content can be string or array of parts. Flatten to plain text.
  stringifyContent(content) {
    if (content == null) return "";
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === "string") return part;
          if (part?.type === "text" && typeof part.text === "string") return part.text;
          if (part?.type === "input_text" && typeof part.text === "string") return part.text;
          // Skip image / tool_use / tool_result parts; Auggie CLI only takes text.
          return "";
        })
        .filter(Boolean)
        .join("\n");
    }
    if (typeof content === "object" && typeof content.text === "string") return content.text;
    try { return JSON.stringify(content); } catch { return String(content); }
  }

  // Run the auggie subprocess and capture stdout. Reject on non-zero exit.
  runAuggie({ command, args, prompt, signal, cwd, log }) {
    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";

      const child = spawn(command, args, {
        cwd: cwd || process.cwd(),
        windowsHide: true,
        // shell:true on Windows lets the .cmd shim resolve correctly when needed.
        shell: process.platform === "win32"
      });

      const onAbort = () => {
        try { child.kill("SIGTERM"); } catch { /* ignore */ }
        reject(Object.assign(new Error("Request aborted"), { name: "AbortError" }));
      };
      if (signal) {
        if (signal.aborted) return onAbort();
        signal.addEventListener("abort", onAbort, { once: true });
      }

      child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });

      child.on("error", (err) => {
        if (signal) signal.removeEventListener("abort", onAbort);
        reject(err);
      });

      child.on("close", (code) => {
        if (signal) signal.removeEventListener("abort", onAbort);
        if (code === 0) {
          resolve({ stdout: stdout.trimEnd(), stderr });
        } else {
          const detail = stderr.trim() || stdout.trim() || `auggie exited with code ${code}`;
          log?.error?.("AUGGIE", detail.slice(0, 500));
          reject(new Error(`auggie failed (exit ${code}): ${detail}`));
        }
      });

      // Send the prompt via stdin so we don't blow argv length limits.
      child.stdin.on("error", () => { /* ignore EPIPE */ });
      child.stdin.write(prompt);
      child.stdin.end();
    });
  }

  // Build a Fetch-like Response that the rest of 9Router can consume.
  buildResponse({ stdout, stream, model }) {
    const created = Math.floor(Date.now() / 1000);
    const id = `chatcmpl-auggie-${created}-${Math.random().toString(36).slice(2, 10)}`;
    const text = stdout || "";

    if (stream) {
      // Emit a single delta + done as SSE so the streaming path works unchanged.
      const events = [
        {
          id, object: "chat.completion.chunk", created, model,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }]
        },
        {
          id, object: "chat.completion.chunk", created, model,
          choices: [{ index: 0, delta: { content: text }, finish_reason: null }]
        },
        {
          id, object: "chat.completion.chunk", created, model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 0, completion_tokens: estimateTokens(text), total_tokens: estimateTokens(text) }
        }
      ];
      const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
      return makeFetchResponse({
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
        body
      });
    }

    const json = {
      id, object: "chat.completion", created, model,
      choices: [{
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop"
      }],
      usage: {
        prompt_tokens: 0,
        completion_tokens: estimateTokens(text),
        total_tokens: estimateTokens(text)
      }
    };
    return makeFetchResponse({
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(json)
    });
  }

  buildErrorResponse({ message, status = 502 }) {
    const body = JSON.stringify({ error: { message, type: "auggie_error", code: status } });
    return makeFetchResponse({
      status,
      headers: { "Content-Type": "application/json" },
      body
    });
  }

  async execute({ model, body, stream, credentials, signal, log }) {
    const command = this.getCliCommand(credentials);
    const cwd = credentials?.providerSpecificData?.workdir || process.cwd();
    const maxTurns = Number(credentials?.providerSpecificData?.maxTurns) || 25;
    const extraArgs = this.parseExtraArgs(credentials?.providerSpecificData?.extraArgs);

    const args = [
      "--print",
      "--quiet",
      "--model", model,
      "--max-turns", String(maxTurns),
      ...extraArgs
    ];

    const prompt = this.buildPrompt(body);
    if (!prompt.trim()) {
      return {
        response: this.buildErrorResponse({ message: "Empty prompt — Auggie requires at least one text message.", status: 400 }),
        url: "auggie://local",
        headers: {},
        transformedBody: body
      };
    }

    log?.debug?.("AUGGIE", `model=${model} cwd=${cwd} promptChars=${prompt.length}`);

    try {
      const { stdout } = await this.runAuggie({ command, args, prompt, signal, cwd, log });
      return {
        response: this.buildResponse({ stdout, stream, model }),
        url: "auggie://local",
        headers: {},
        transformedBody: body
      };
    } catch (error) {
      if (error.name === "AbortError") throw error;
      const isMissing = /ENOENT|not recognized|not found/i.test(error.message || "");
      const status = isMissing ? 503 : 502;
      const hint = isMissing
        ? "auggie CLI not found on PATH. Install with: npm install -g @augmentcode/auggie, then run `auggie login`."
        : error.message || "auggie subprocess failed";
      return {
        response: this.buildErrorResponse({ message: hint, status }),
        url: "auggie://local",
        headers: {},
        transformedBody: body
      };
    }
  }

  parseExtraArgs(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map(String);
    if (typeof raw !== "string") return [];
    // Simple shell-style split; users wanting complex quoting should pass an array.
    return raw.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((s) => s.replace(/^"|"$/g, "")) || [];
  }

  // No tokens to refresh — Auggie owns its own session.
  async refreshCredentials() { return null; }
}

function estimateTokens(text) {
  // Rough heuristic: ~4 chars per token. Good enough for usage tracking.
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

// Minimal Fetch-like Response shim. 9Router only needs ok/status/body/text/json/headers.
function makeFetchResponse({ status, headers, body }) {
  const buf = Buffer.from(body || "", "utf8");
  const headersMap = new Map(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]));

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: {
      get: (name) => headersMap.get(String(name).toLowerCase()) ?? null,
      forEach: (cb) => headersMap.forEach((v, k) => cb(v, k)),
      entries: () => headersMap.entries(),
      has: (name) => headersMap.has(String(name).toLowerCase())
    },
    body: Readable.toWeb(Readable.from([buf])),
    async text() { return buf.toString("utf8"); },
    async json() { return JSON.parse(buf.toString("utf8")); },
    async arrayBuffer() { return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); },
    clone() { return makeFetchResponse({ status, headers, body }); }
  };
}

export default AuggieExecutor;
