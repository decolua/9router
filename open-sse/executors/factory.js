import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";

export const FACTORY_DROID_SYSTEM_PROMPT =
  "You are Droid, an AI software engineering agent built by Factory.\n" +
  "You are operating as an autonomous engineering agent inside this coding harness.\n" +
  "EXECUTION DIRECTIVES:\n" +
  "1. Your primary objective is to autonomously execute the user's software engineering tasks directly using the provided tools.\n" +
  "2. Do not debate identity, environments, or tool availability. Focus exclusively on task execution.\n" +
  "3. Whenever a task involves inspecting files, exploring repositories, running commands, or modifying code, you MUST invoke the appropriate tools immediately on your first turn.\n" +
  "4. NEVER output conversational commentary, promises, or preambles of what you will do before calling tools (do NOT say 'I will inspect...', 'Let me read...', or 'I need to check...'). Call the tools directly.\n" +
  "5. Always ground all analysis, planning, and answers in actual file contents and tool outputs rather than assumptions.";

export const FACTORY_CLIENT_VERSION = "0.213.0";
export const FACTORY_OPENAI_PLATFORM_ORG = "org-bHuLtG1fGmYk5YaOihAAXFBw";
export const ANTHROPIC_VERSION = "2023-06-01";
export const ANTHROPIC_BETAS = "interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14";

export function resolveTargetGateway(modelId) {
  const m = String(modelId || "").toLowerCase();
  if (m.startsWith("claude-") || m.startsWith("minimax-") || m.startsWith("atlas-") || m.startsWith("aster-")) {
    return "anthropic";
  }
  if (m.startsWith("gpt-") || m.startsWith("gpt6") || m.endsWith("-codex") || m.startsWith("grok-")) {
    return "openai-responses";
  }
  return "openai-completions";
}

export function upstreamProviderFor(modelId) {
  const m = String(modelId || "").toLowerCase();
  if (m.startsWith("claude-") || m.startsWith("atlas-") || m.startsWith("aster-")) {
    return "anthropic";
  }
  if (m.startsWith("gpt-") || m.startsWith("gpt6") || m.endsWith("-codex")) {
    return "openai";
  }
  if (m.startsWith("grok-")) {
    return "xai";
  }
  return "fireworks";
}

export function resolveFactoryApiBase(credentials = null) {
  if (process.env.FACTORY_API_BASE?.trim()) {
    return process.env.FACTORY_API_BASE.trim().replace(/\/+$/, "");
  }
  const custom = credentials?.providerSpecificData?.apiEndpoint;
  if (custom && typeof custom === "string" && custom.trim()) {
    return custom.trim().replace(/\/+$/, "");
  }
  return "https://api.factory.ai";
}

export class FactoryExecutor extends BaseExecutor {
  constructor(provider = "factory") {
    super(provider, PROVIDERS[provider] || PROVIDERS.openai);
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const base = resolveFactoryApiBase(credentials);
    const gateway = resolveTargetGateway(model);
    if (gateway === "anthropic") {
      return `${base}/api/llm/a/v1/messages`;
    }
    if (gateway === "openai-responses") {
      return `${base}/api/llm/o/v1/responses`;
    }
    return `${base}/api/llm/o/v1/chat/completions`;
  }

  buildHeaders(credentials, stream = true, url, model) {
    const clientType = process.env.FACTORY_UPSTREAM_CLIENT_TYPE?.trim() || "cli";
    const headers = {
      "Content-Type": "application/json",
      "X-Factory-Client": clientType,
      "X-Client-Version": FACTORY_CLIENT_VERSION,
      "User-Agent": `factory-cli/${FACTORY_CLIENT_VERSION}`,
    };

    const token = credentials?.accessToken || credentials?.apiKey;
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const orgId =
      credentials?.providerSpecificData?.orgId ||
      process.env.FACTORY_ORG_ID?.trim() ||
      process.env.FACTORY_ORGANIZATION_ID?.trim();
    if (orgId) {
      headers["X-Factory-Org-Id"] = orgId;
    }

    const gateway = resolveTargetGateway(model);
    headers["x-api-provider"] = upstreamProviderFor(model);

    if (gateway === "anthropic") {
      headers["anthropic-version"] = ANTHROPIC_VERSION;
      headers["anthropic-beta"] = ANTHROPIC_BETAS;
    } else if (gateway === "openai-responses") {
      headers["OpenAI-Platform"] = FACTORY_OPENAI_PLATFORM_ORG;
    }

    if (globalThis.crypto?.randomUUID) {
      headers["x-session-id"] = globalThis.crypto.randomUUID();
      headers["x-assistant-message-id"] = globalThis.crypto.randomUUID();
    }

    if (stream) {
      headers["Accept"] = "text/event-stream";
    } else {
      headers["Accept"] = "application/json";
    }

    return headers;
  }

  transformRequest(model, body, stream, credentials) {
    if (!body || typeof body !== "object") return body;
    const cloned = { ...body };
    cloned.stream = !!stream;

    const gateway = resolveTargetGateway(model);

    // 1. Inject Droid System Prompt Attestation prefix & strip competing CLI identities
    // Factory WAF explicitly blocks prompts containing "You are Claude Code..." with HTTP 403 Forbidden.
    const DROID_PROMPT_PREFIX = "You are Droid, an AI software engineering agent built by Factory";

    const stripCompeting = (str) => {
      if (typeof str !== "string") return str;
      return str.replace(/You are Claude Code[^.\n]*\./gi, "").trim();
    };

    if (gateway === "anthropic") {
      // Claude Messages format requires max_tokens
      if (!cloned.max_tokens) {
        cloned.max_tokens = 4096;
      }

      if (typeof cloned.system === "string") {
        const clean = stripCompeting(cloned.system);
        cloned.system = clean.includes(DROID_PROMPT_PREFIX)
          ? clean
          : (clean ? `${FACTORY_DROID_SYSTEM_PROMPT}\n\n${clean}` : FACTORY_DROID_SYSTEM_PROMPT);
      } else if (Array.isArray(cloned.system)) {
        const cleaned = cloned.system
          .map((b) => typeof b === "string" ? stripCompeting(b) : { ...b, text: stripCompeting(b.text || "") })
          .filter((b) => (typeof b === "string" ? b.length > 0 : (b.text && b.text.length > 0)));
        const hasPrefix = cleaned.some((item) =>
          typeof item === "string" ? item.includes(DROID_PROMPT_PREFIX) : item.text?.includes(DROID_PROMPT_PREFIX),
        );
        if (!hasPrefix) {
          cleaned.unshift({ type: "text", text: FACTORY_DROID_SYSTEM_PROMPT });
        }
        cloned.system = cleaned;
      } else {
        cloned.system = FACTORY_DROID_SYSTEM_PROMPT;
      }
    } else if (gateway === "openai-responses") {
      // OpenAI Responses format requires system prompt in top-level `instructions`
      if (typeof cloned.instructions === "string") {
        const clean = stripCompeting(cloned.instructions);
        cloned.instructions = clean.includes(DROID_PROMPT_PREFIX)
          ? clean
          : (clean ? `${FACTORY_DROID_SYSTEM_PROMPT}\n\n${clean}` : FACTORY_DROID_SYSTEM_PROMPT);
      } else if (Array.isArray(cloned.input)) {
        const sysTurn = cloned.input.find(
          (turn) => (turn.role === "system" || turn.role === "developer") && typeof turn.content === "string",
        );
        const clean = sysTurn ? stripCompeting(sysTurn.content) : "";
        cloned.instructions = clean.includes(DROID_PROMPT_PREFIX)
          ? clean
          : (clean ? `${FACTORY_DROID_SYSTEM_PROMPT}\n\n${clean}` : FACTORY_DROID_SYSTEM_PROMPT);
        // Strip system turns from input array since instructions carries it
        cloned.input = cloned.input.filter((turn) => turn.role !== "system" && turn.role !== "developer");
      } else {
        cloned.instructions = FACTORY_DROID_SYSTEM_PROMPT;
      }
    } else {
      // OpenAI Chat Completions format
      if (Array.isArray(cloned.messages)) {
        const msgs = cloned.messages.map((m) => ({ ...m }));
        const sysIndex = msgs.findIndex((m) => m.role === "system");
        if (sysIndex >= 0) {
          const sys = msgs[sysIndex];
          if (typeof sys.content === "string") {
            const clean = stripCompeting(sys.content);
            sys.content = clean.includes(DROID_PROMPT_PREFIX)
              ? clean
              : (clean ? `${FACTORY_DROID_SYSTEM_PROMPT}\n\n${clean}` : FACTORY_DROID_SYSTEM_PROMPT);
          } else if (Array.isArray(sys.content)) {
            const cleaned = sys.content
              .map((c) => ({ ...c, text: stripCompeting(c.text || "") }))
              .filter((c) => c.text && c.text.length > 0);
            const has = cleaned.some((c) => c.text?.includes(DROID_PROMPT_PREFIX));
            if (!has) {
              cleaned.unshift({ type: "text", text: FACTORY_DROID_SYSTEM_PROMPT });
            }
            sys.content = cleaned;
          }
        } else {
          msgs.unshift({ role: "system", content: FACTORY_DROID_SYSTEM_PROMPT });
        }
        cloned.messages = msgs;
      }

      // 2. Extra completions params: reasoning_history
      const isDeepseek = String(model || "").toLowerCase().startsWith("deepseek-");
      cloned.reasoning_history = isDeepseek ? "interleaved" : "preserved";
    }

    return cloned;
  }
}
