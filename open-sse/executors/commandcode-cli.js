import { randomUUID } from "crypto";
import { spawn } from "child_process";
import os from "os";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { resolveCommandCodeCliBin } from "../services/commandCodeCliBin.js";

const DEFAULT_MAX_TURNS = 4;
const DEFAULT_TIMEOUT_MS = 180000;

export class CommandCodeCLIExecutor extends BaseExecutor {
  constructor() {
    super("commandcode-cli", PROVIDERS["commandcode-cli"]);
  }

  async execute({ model, body, credentials, signal, log }) {
    const upstreamModel = toUpstreamModel(model);
    if (!upstreamModel) {
      return {
        response: errorResponse(400, `Unsupported Command Code CLI model: ${model}`),
        url: "cmd",
        headers: {},
        transformedBody: body,
      };
    }

    const responseModel = toResponseModel(model);
    const providerSpecificData = credentials?.providerSpecificData || {};
    const maxTurns = normalizePositiveInt(providerSpecificData.maxTurns, DEFAULT_MAX_TURNS);
    const timeoutMs = normalizePositiveInt(providerSpecificData.timeoutMs, DEFAULT_TIMEOUT_MS);
    const prompt = messagesToPrompt(body?.messages || []);
    const args = [
      "--model", upstreamModel,
      "-p", prompt,
      "--skip-onboarding",
      "--trust",
      "--max-turns", String(maxTurns),
    ];

    log?.debug?.("COMMANDCODE-CLI", `command-code-cli ${args.map(maskArgForLog).join(" ")} | timeout=${Math.round(timeoutMs / 1000)}s`);

    const result = await runCommandCodeCli(args, timeoutMs, signal);
    if (result.stderr) {
      log?.debug?.("COMMANDCODE-CLI STDERR", sanitizeLog(result.stderr));
    }

    const transformedBody = { model: upstreamModel, responseModel, maxTurns, timeoutMs };
    if (result.error) {
      return {
        response: errorResponse(result.status, result.error),
        url: "cmd",
        headers: {},
        transformedBody,
      };
    }

    const content = result.stdout.trim();
    if (body?.stream === true) {
      return {
        response: new Response(buildChatCompletionStream(responseModel, content), {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
          },
        }),
        url: "cmd",
        headers: {},
        transformedBody,
      };
    }

    return {
      response: new Response(JSON.stringify(buildChatCompletion(responseModel, content)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
      url: "cmd",
      headers: {},
      transformedBody,
    };
  }
}

function runCommandCodeCli(args, timeoutMs, signal) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const child = spawn(resolveCommandCodeCliBin(), args, {
      shell: false,
      windowsHide: true,
      env: process.env,
      cwd: os.tmpdir(),
    });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      finish({
        stdout,
        stderr,
        status: 504,
        error: `Command Code CLI timed out after ${Math.round(timeoutMs / 1000)}s`,
      });
    }, timeoutMs);

    const abort = () => {
      child.kill("SIGTERM");
      finish({ stdout, stderr, status: 499, error: "Request aborted" });
    };

    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener?.("abort", abort, { once: true });

    child.stdout?.on?.("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on?.("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (error?.code === "ENOENT") {
        finish({
          stdout,
          stderr,
          status: 502,
          error: "Command Code CLI not found. Install with: npm i -g command-code",
        });
        return;
      }
      finish({ stdout, stderr, status: 502, error: error.message || "Command Code CLI failed to start" });
    });

    child.on("close", (code) => {
      signal?.removeEventListener?.("abort", abort);
      if (settled || timedOut) return;
      if (code === 0) {
        finish({ stdout, stderr, status: 200 });
        return;
      }
      const stderrText = stderr.trim();
      const authError = /login|auth|authenticate|unauthorized|forbidden/i.test(stderrText);
      finish({
        stdout,
        stderr,
        status: authError ? 401 : 502,
        error: authError
          ? "Command Code CLI is not authenticated. Run: cmd login"
          : `Command Code CLI failed with exit code ${code}${stderrText ? `: ${sanitizeLog(stderrText)}` : ""}`,
      });
    });
  });
}

export function toUpstreamModel(model) {
  if (typeof model !== "string") return null;
  if (model.startsWith("cccli/")) return model.slice("cccli/".length);
  return model.trim() || null;
}

function toResponseModel(model) {
  if (typeof model !== "string") return "cccli/unknown";
  if (model.startsWith("cccli/")) return model;
  return `cccli/${model}`;
}

function messagesToPrompt(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return "";
  return messages
    .map((message) => {
      const role = message?.role || "user";
      return `${role}: ${contentToText(message?.content)}`;
    })
    .join("\n\n");
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part?.type === "text") return part.text || "";
        if (part?.text) return part.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content == null) return "";
  return String(content);
}

function buildChatCompletion(model, content) {
  return {
    id: `chatcmpl-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: { role: "assistant", content },
      finish_reason: "stop",
    }],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  };
}

function buildChatCompletionStream(model, content) {
  const id = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const chunks = [
    {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    },
    {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: { content }, finish_reason: null }],
    },
    {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    },
  ];

  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }
      controller.close();
    },
  });
}

function normalizePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function errorResponse(status, message) {
  return new Response(JSON.stringify({ error: { message, type: "provider_error", code: "commandcode_cli_error" } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sanitizeLog(text) {
  return String(text || "")
    .replace(/(Authorization:\s*Bearer\s+)[^\s]+/gi, "$1[redacted]")
    .replace(/(api[_-]?key["'=:\s]+)[^"'\s]+/gi, "$1[redacted]")
    .slice(0, 4000);
}

function maskArgForLog(arg, index, args) {
  if (args[index - 1] === "-p") return "[prompt]";
  return arg;
}

export default CommandCodeCLIExecutor;
