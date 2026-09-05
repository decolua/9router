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
export const ANTHROPIC_EFFORT_BETA = "effort-2025-11-24";

// Server-generated item ID prefixes from OpenAI Responses that cause 404 with store=false
const SERVER_ID_PATTERN = /^(rs|fc|resp|msg)_/;



export function embeddedToolCallFromName(name) {
  if (typeof name !== "string" || !name.trimStart().startsWith("{")) {
    return null;
  }
  try {
    const parsed = JSON.parse(name);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || typeof parsed.name !== "string" || parsed.name.length === 0) {
      return null;
    }
    let args = parsed.arguments ?? {};
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch {
        // keep string
      }
    }
    return { name: parsed.name, arguments: args };
  } catch {
    return null;
  }
}

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

export function resolveClaudeThinking(modelId, requestedEffort) {
  const m = String(modelId || "").toLowerCase();
  const effort = requestedEffort || "high";

  // Adaptive models
  if (
    m.startsWith("claude-fable-5.1") ||
    m.startsWith("claude-fable-5") ||
    m.startsWith("claude-opus-5") ||
    m.startsWith("claude-opus-4-8")
  ) {
    return {
      thinking: { type: "adaptive", display: "summarized" },
      outputConfig: { effort },
      requiresEffortBeta: true,
    };
  }

  // Sonnet 4.6
  if (m.startsWith("claude-sonnet-4-6")) {
    return {
      thinking: { type: "adaptive" },
      outputConfig: { effort },
      requiresEffortBeta: true,
    };
  }

  // Opus 4.5
  if (m.startsWith("claude-opus-4-5-20251101") || m.startsWith("claude-opus-4-5")) {
    return {
      thinking: { type: "enabled", budget_tokens: 24576 },
      outputConfig: { effort },
      requiresEffortBeta: true,
    };
  }

  // MiniMax
  if (m.startsWith("minimax-")) {
    let budget = 2048;
    if (typeof requestedEffort === "number" && requestedEffort >= 1024) {
      budget = requestedEffort;
    } else if (requestedEffort === "low") {
      budget = 1024;
    } else if (requestedEffort === "medium") {
      budget = 2048;
    } else if (requestedEffort === "high" || requestedEffort === "xhigh" || requestedEffort === "max") {
      budget = 4096;
    }
    return {
      thinking: { type: "enabled", budget_tokens: budget },
      outputConfig: undefined,
      requiresEffortBeta: false,
    };
  }

  return {
    thinking: undefined,
    outputConfig: undefined,
    requiresEffortBeta: false,
  };
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
      const thinkingMeta = resolveClaudeThinking(model, credentials?._requestedEffort);
      if (thinkingMeta.requiresEffortBeta) {
        headers["anthropic-beta"] = `${ANTHROPIC_BETAS},${ANTHROPIC_EFFORT_BETA}`;
      } else {
        headers["anthropic-beta"] = ANTHROPIC_BETAS;
      }
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
    const m = String(model || "").toLowerCase();

    if (Array.isArray(cloned.tools) && cloned.tools.length > 0) {
      if (gateway === "anthropic") {
        // Claude tool shape: { name, description, input_schema }
        cloned.tools = cloned.tools.map((t) => {
          if (!t || typeof t !== "object") return t;
          const name = t.name || t.function?.name || "";
          const desc = t.description || t.function?.description || "";
          const schema = t.input_schema || t.parameters || t.function?.parameters || { type: "object" };
          return {
            name,
            description: desc,
            input_schema: schema,
          };
        });
      } else if (gateway === "openai-responses") {
        // OpenAI Responses flat shape: { type: "function", name, description, parameters }
        cloned.tools = cloned.tools.map((t) => {
          if (!t || typeof t !== "object") return t;
          const rawName = t.name || t.function?.name || "";
          const desc = t.description || t.function?.description || "";
          const params = t.parameters || t.function?.parameters || { type: "object", properties: {} };
          return {
            type: "function",
            name: rawName,
            description: desc,
            parameters: params,
            ...(t.strict || t.function?.strict ? { strict: true } : {}),
          };
        });
        cloned.tool_choice = "auto";
        cloned.parallel_tool_calls = true;
      } else {
        // OpenAI Chat shape: { type: "function", function: { name, description, parameters } }
        cloned.tools = cloned.tools.map((t) => {
          if (!t || typeof t !== "object") return t;
          if (t.function && typeof t.function === "object") {
            return t;
          }
          if (typeof t.name === "string") {
            return {
              type: "function",
              function: { name: t.name, description: t.description || "", parameters: t.parameters || {} },
            };
          }
          return t;
        });
        cloned.tool_choice = "auto";
      }
    }

    // 2. Inject Droid System Prompt Attestation prefix & strip competing CLI identities
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

      // Thinking & Effort configuration
      const thinkingConfig = resolveClaudeThinking(
        model,
        cloned.thinking?.budget_tokens || cloned.reasoning_effort || cloned.thinking?.effort,
      );
      if (thinkingConfig.thinking) {
        cloned.thinking = thinkingConfig.thinking;
      }
      if (thinkingConfig.outputConfig) {
        cloned.output_config = thinkingConfig.outputConfig;
      } else {
        delete cloned.output_config;
      }

      // Ensure max_tokens > budget_tokens if thinking is enabled (Anthropic / Fireworks requirement)
      if (cloned.thinking?.type === "enabled" && cloned.thinking.budget_tokens) {
        const minRequired = cloned.thinking.budget_tokens + 1024;
        if (cloned.max_tokens < minRequired) {
          cloned.max_tokens = minRequired;
        }
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
        cloned.system = [{ type: "text", text: FACTORY_DROID_SYSTEM_PROMPT }];
      }
    } else if (gateway === "openai-responses") {
      // OpenAI Responses format requires system prompt in top-level `instructions`
      cloned.store = false;

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

      // Strip server-generated IDs to prevent 404
      if (Array.isArray(cloned.input)) {
        cloned.input = cloned.input.filter((item) => {
          if (typeof item === "string" && SERVER_ID_PATTERN.test(item)) return false;
          if (item && typeof item === "object" && !Array.isArray(item)) {
            if (item.type === "item_reference") return false;
            if (typeof item.id === "string" && SERVER_ID_PATTERN.test(item.id)) delete item.id;
          }
          return true;
        });
      }
    } else {
      // OpenAI Chat Completions format (Factory Core / Fireworks gateway)
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

        // 3. Fireworks / Factory Core requirements for assistant tool turns and tool results
        const isDeepseek = m.startsWith("deepseek-");
        const isKimi = m.startsWith("kimi-");
        const isGlm = m.startsWith("glm-");

        for (const msg of msgs) {
          if (msg.role === "assistant" && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
            // requiresAssistantContentForToolCalls
            if (msg.content === undefined || msg.content === null) {
              msg.content = "";
            }
            // requiresReasoningContentForToolCalls
            if (msg.reasoning_content === undefined || msg.reasoning_content === null) {
              msg.reasoning_content = isDeepseek ? "" : (isKimi || isGlm ? "." : "");
            }
          }
          // requiresToolResultName for Kimi
          if (msg.role === "tool" && isKimi && !msg.name) {
            // Attempt to resolve name from tool_call_id
            const matchedAssistant = msgs.find((a) =>
              a.role === "assistant" && Array.isArray(a.tool_calls) && a.tool_calls.some((tc) => tc.id === msg.tool_call_id),
            );
            const matchedTc = matchedAssistant?.tool_calls?.find((tc) => tc.id === msg.tool_call_id);
            if (matchedTc?.function?.name) {
              msg.name = matchedTc.function.name;
            }
          }
        }

        cloned.messages = msgs;
      }

      // 4. Reasoning history for completions gateway
      const isDeepseek = m.startsWith("deepseek-");
      cloned.reasoning_history = isDeepseek ? "interleaved" : "preserved";
    }

    return cloned;
  }
}

