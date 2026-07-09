/**
 * Claude → Kiro Request Translator (DIRECT route, no OpenAI pivot)
 *
 * Converts Anthropic Messages API requests straight to Kiro / AWS
 * CodeWhisperer `GenerateAssistantResponse` payloads. This is the function the
 * direct `claude:kiro` route in ../index.js uses; it is NOT reached through the
 * claude→openai→kiro pivot.
 *
 * It reproduces the two 400-guards that live in openai-to-kiro.js so that a
 * Claude client which omits the `tools` array on a follow-up turn (typical
 * after client-side compaction) does not trip Kiro's schema validator and get
 * "Improperly formed request" (HTTP 400):
 *
 *   1. flattenClaudeToolInteractions — when the client sent NO tools, collapse
 *      every tool_use / tool_result block to plain text so no structured tool
 *      reference survives to trigger the "tools required" rule.
 *   2. reconcileOrphanedToolResults — when tools ARE present, fold any
 *      tool_result whose tool_use_id has no matching tool_use back into the
 *      user text instead of leaving a dangling structured reference.
 *
 * It also handles the 9router-synthetic `-agentic` / `-thinking` suffixes and
 * the `<thinking_mode>enabled</thinking_mode>` reasoning trigger, matching
 * buildKiroPayload.
 */
import crypto from "crypto";
import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { resolveSessionId } from "../../utils/sessionManager.js";
import {
  resolveKiroModel,
  resolveKiroThinkingBudget,
  buildThinkingSystemPrefix,
  KIRO_AGENTIC_SYSTEM_PROMPT,
  resolveDefaultProfileArn,
} from "../../config/kiroConstants.js";
import { DEFAULT_IMAGE_MIME } from "../schema/index.js";
import { ROLE, CLAUDE_BLOCK } from "../schema/index.js";

const VOLATILE_SESSION_HEADER_KEYS = new Set(["x-client-request-id"]);
const EXPLICIT_SESSION_BODY_KEYS = ["prompt_cache_key", "session_id", "conversation_id"];
const SLACK_CHANNEL_RE = "[CGD][A-Z0-9]{8,}";
const SLACK_TS_RE = "\\d{10}(?:\\.\\d{1,6})?|\\d{16}";
const SLACK_TS_URL_RE = "\\d{10}(?:(?:\\.|%2E)\\d{1,6})?|\\d{16}";
const FIRST_USER_ANCHOR_MAX = 2048;
const CACHE_CONTROL_KEY = "cache_control";
const KIRO_DEFAULT_CACHE_POINT = { type: "default" };

function withoutVolatileSessionHeaders(headers) {
  if (!headers || typeof headers !== "object") return headers;

  const stableHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    if (VOLATILE_SESSION_HEADER_KEYS.has(String(key).toLowerCase())) continue;
    stableHeaders[key] = value;
  }
  return stableHeaders;
}

function deterministicUuid(value) {
  const bytes = crypto.createHash("sha256").update(String(value)).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizeAnchorText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value).replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

function hasCacheControl(value) {
  return value && typeof value === "object" && value[CACHE_CONTROL_KEY] !== undefined;
}

function stripCacheControlForAnchor(value) {
  if (Array.isArray(value)) return value.map(stripCacheControlForAnchor);
  if (!value || typeof value !== "object") return value;

  const clean = {};
  for (const key of Object.keys(value).sort()) {
    if (key === CACHE_CONTROL_KEY) continue;
    const child = stripCacheControlForAnchor(value[key]);
    if (child !== undefined) clean[key] = child;
  }
  return clean;
}

function stableAnchorJson(value) {
  return JSON.stringify(stripCacheControlForAnchor(value));
}

function collectCacheControlAnchorSegments(body) {
  const segments = [];
  const pushSegment = (kind, value, cacheControlBearing = false) => {
    segments.push({
      kind,
      cacheControlBearing,
      value: stableAnchorJson([kind, value]),
    });
  };

  if (typeof body?.system === "string") {
    pushSegment("system:text", body.system);
  } else if (Array.isArray(body?.system)) {
    for (const part of body.system) {
      pushSegment("system:block", part, hasCacheControl(part));
    }
  } else if (body?.system) {
    pushSegment("system:block", body.system, hasCacheControl(body.system));
  }

  if (Array.isArray(body?.tools)) {
    for (const tool of body.tools) {
      pushSegment("tool", tool, hasCacheControl(tool));
    }
  }

  if (Array.isArray(body?.messages)) {
    for (const message of body.messages) {
      const role = message?.role || "unknown";
      const content = message?.content;
      if (typeof content === "string") {
        pushSegment(`message:${role}:text`, content);
      } else if (Array.isArray(content)) {
        for (const block of content) {
          const kind =
            typeof block === "string"
              ? `message:${role}:text`
              : `message:${role}:${block?.type || "block"}`;
          pushSegment(kind, block, hasCacheControl(block));
        }
      } else if (content !== undefined && content !== null) {
        pushSegment(`message:${role}:block`, content, hasCacheControl(content));
      }
    }
  }

  return segments;
}

function findClaudeCacheControlAnchor(body) {
  const segments = collectCacheControlAnchorSegments(body);
  let lastCacheControlIndex = -1;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].cacheControlBearing) lastCacheControlIndex = i;
  }
  if (lastCacheControlIndex === -1) return null;

  const prefix = segments
    .slice(0, lastCacheControlIndex + 1)
    .map((segment) => segment.value)
    .join("\n");
  return `cache-control:${prefix}`;
}

function findLastClaudeCacheControlKind(body) {
  const segments = collectCacheControlAnchorSegments(body);
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i].cacheControlBearing) return segments[i].kind;
  }
  return null;
}

function cachePointBelongsOnCurrentMessage(body) {
  const kind = findLastClaudeCacheControlKind(body);
  return kind === "tool";
}

function applyDefaultKiroCachePoint(userInputMessage) {
  if (userInputMessage) {
    userInputMessage.cachePoint = { ...KIRO_DEFAULT_CACHE_POINT };
  }
}

function systemPartText(part) {
  if (typeof part === "string") return part;
  if (!part || typeof part !== "object") return "";
  if (typeof part.text === "string") return part.text;
  return "";
}

function splitSystemCacheControl(system) {
  if (!system) return { fullText: "", cachedText: "", uncachedText: "" };

  const parts = Array.isArray(system) ? system : [system];
  const texts = parts.map(systemPartText);
  const fullText = texts.filter(Boolean).join("\n");
  let lastCacheControlIndex = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (hasCacheControl(parts[i])) {
      lastCacheControlIndex = i;
      break;
    }
  }

  if (lastCacheControlIndex === -1) {
    return { fullText, cachedText: "", uncachedText: fullText };
  }

  return {
    fullText,
    cachedText: texts.slice(0, lastCacheControlIndex + 1).filter(Boolean).join("\n"),
    uncachedText: texts.slice(lastCacheControlIndex + 1).filter(Boolean).join("\n"),
  };
}

function renderInstructions(text) {
  return `<instructions>\n${text}\n</instructions>`;
}

function buildCachedSystemPrefix(systemText, thinkingBudget, agentic) {
  const prefixParts = [];
  if (thinkingBudget !== null) prefixParts.push(buildThinkingSystemPrefix(thinkingBudget));
  if (agentic) prefixParts.push(KIRO_AGENTIC_SYSTEM_PROMPT);
  if (systemText) prefixParts.push(renderInstructions(systemText));
  return prefixParts.filter(Boolean).join("\n\n");
}

function isRenderableUserBlock(block) {
  if (typeof block === "string") return block.trim().length > 0;
  if (!block || typeof block !== "object") return false;
  if (block.type === CLAUDE_BLOCK.TEXT) return Boolean(block.text);
  if (block.type === CLAUDE_BLOCK.IMAGE && block.source?.type === "base64") return true;
  if (block.type === CLAUDE_BLOCK.TOOL_RESULT) return true;
  return false;
}

function hasRenderableUserBlockAfter(blocks, startIndex) {
  return blocks.slice(startIndex).some(isRenderableUserBlock);
}

function normalizeSlackTs(value) {
  if (!value) return null;
  const ts = String(value).replace(/%2E/gi, ".").replace(/_/g, ".");
  if (/^\d{16}$/.test(ts)) return `${ts.slice(0, 10)}.${ts.slice(10)}`;
  if (/^\d{10}\.\d{1,6}$/.test(ts)) return ts;
  return null;
}

function extractSlackThreadAnchor(text) {
  const normalized = normalizeAnchorText(text);
  if (!normalized) return null;

  const permalinkRe = new RegExp(
    `/archives/(${SLACK_CHANNEL_RE})/[^\\s<>)]*?[?&]thread_ts=(${SLACK_TS_URL_RE})`,
    "i"
  );
  const permalink = normalized.match(permalinkRe);
  if (permalink) {
    const ts = normalizeSlackTs(permalink[2]);
    if (ts) return `slack:${permalink[1].toUpperCase()}:${ts}`;
  }

  const anchorRe = new RegExp(`\\b(${SLACK_CHANNEL_RE})[:/](${SLACK_TS_RE})\\b`, "i");
  const anchor = normalized.match(anchorRe);
  if (anchor) {
    const ts = normalizeSlackTs(anchor[2]);
    if (ts) return `slack:${anchor[1].toUpperCase()}:${ts}`;
  }

  return null;
}

function claudeContentToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return normalizeAnchorText(content);

  return content
    .map((block) => {
      if (typeof block === "string") return block;
      if (block?.type === CLAUDE_BLOCK.TEXT || typeof block?.text === "string") {
        return block.text || "";
      }
      if (block?.type === CLAUDE_BLOCK.TOOL_RESULT) {
        return claudeContentToText(block.content);
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function systemToText(system) {
  if (typeof system === "string") return system;
  if (!Array.isArray(system)) return "";
  return system
    .map((part) => (typeof part === "string" ? part : part?.text || ""))
    .filter(Boolean)
    .join("\n");
}

function findKiroStableAnchor(body, connectionId) {
  const metadataAnchor = extractSlackThreadAnchor(body?.metadata);
  if (metadataAnchor) return metadataAnchor;

  const systemAnchor = extractSlackThreadAnchor(systemToText(body?.system));
  if (systemAnchor) return systemAnchor;

  const firstUser = Array.isArray(body?.messages)
    ? body.messages.find((message) => message?.role === ROLE.USER)
    : null;
  const firstUserText = claudeContentToText(firstUser?.content);
  const userAnchor = extractSlackThreadAnchor(firstUserText);
  if (userAnchor) return userAnchor;

  return [
    "fallback",
    normalizeAnchorText(connectionId),
    normalizeAnchorText(body?.metadata?.user_id),
    normalizeAnchorText(firstUserText).slice(0, FIRST_USER_ANCHOR_MAX),
  ].join(":");
}

function bodyHasExplicitSessionId(body) {
  return EXPLICIT_SESSION_BODY_KEYS.some((key) => {
    const value = body?.[key];
    return typeof value === "string" ? value.trim() : value !== undefined && value !== null;
  });
}

function explicitBodySessionId(body) {
  for (const key of EXPLICIT_SESSION_BODY_KEYS) {
    const value = body?.[key];
    if (typeof value === "string") {
      const normalized = value.trim();
      if (normalized) return normalized;
    } else if (value !== undefined && value !== null) {
      return String(value);
    }
  }
  return null;
}

function bodyWithKiroPromptCacheKey(body, connectionId) {
  if (bodyHasExplicitSessionId(body)) return body;

  const anchor = findClaudeCacheControlAnchor(body) || findKiroStableAnchor(body, connectionId);
  return {
    ...body,
    prompt_cache_key: deterministicUuid(`kiro:${anchor}`),
  };
}

function resolveKiroConversationId(body, credentials) {
  const explicitSessionId = explicitBodySessionId(body);
  if (explicitSessionId) return explicitSessionId;

  const cacheControlAnchor = findClaudeCacheControlAnchor(body);
  if (cacheControlAnchor) return deterministicUuid(`kiro:${cacheControlAnchor}`);

  return resolveSessionId({
    headers: withoutVolatileSessionHeaders(credentials?.rawHeaders),
    body: bodyWithKiroPromptCacheKey(body, credentials?.connectionId),
    connectionId: credentials?.connectionId,
    scope: "kiro",
  });
}

/** Stringify a tool_use input as a readable line. */
function toolUseToText(name, input) {
  let argStr;
  try {
    argStr = typeof input === "string" ? input : JSON.stringify(input ?? {});
  } catch {
    argStr = "{}";
  }
  return `[Tool call: ${name || "unknown"}(${argStr})]`;
}

/** Render a Claude tool_result block's content as a readable line. */
function toolResultBlockToText(content) {
  let text = "";
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .map((c) => (typeof c === "string" ? c : c?.text || ""))
      .filter(Boolean)
      .join("\n");
  } else if (content) {
    try {
      text = JSON.stringify(content);
    } catch {
      text = "";
    }
  }
  return `[Tool result: ${text}]`;
}

/**
 * When the client sent no tools, rewrite every tool_use (assistant) and
 * tool_result (user) content block into plain text. Keeps text + images.
 * Returns a new messages array; never mutates the input.
 */
function flattenClaudeToolInteractions(messages) {
  const out = [];
  for (const msg of messages) {
    if (!msg) continue;

    if (msg.role === ROLE.ASSISTANT && Array.isArray(msg.content)) {
      const parts = [];
      for (const block of msg.content) {
        if (block.type === CLAUDE_BLOCK.TEXT && block.text) {
          parts.push(block.text);
        } else if (block.type === CLAUDE_BLOCK.TOOL_USE) {
          parts.push(toolUseToText(block.name, block.input));
        }
      }
      out.push({ ...msg, content: parts.join("\n") });
      continue;
    }

    if (msg.role === ROLE.USER && Array.isArray(msg.content)) {
      const newContent = msg.content.map((block) =>
        block.type === CLAUDE_BLOCK.TOOL_RESULT
          ? {
              type: CLAUDE_BLOCK.TEXT,
              text: toolResultBlockToText(block.content),
              ...(hasCacheControl(block) && { [CACHE_CONTROL_KEY]: block[CACHE_CONTROL_KEY] }),
            }
          : block
      );
      out.push({ ...msg, content: newContent });
      continue;
    }

    out.push(msg);
  }
  return out;
}

/**
 * Convert Claude messages to Kiro history + currentMessage.
 * Kiro requires alternating user/assistant turns; consecutive same-role
 * messages are merged.
 */
function convertClaudeMessagesToKiro(messages, tools, model) {
  const history = [];
  let currentMessage = null;

  let pendingUserContent = [];
  let pendingAssistantContent = [];
  let pendingToolResults = [];
  let pendingImages = [];
  let pendingUserCachePoint = false;
  let pendingCachePointForNextUser = false;
  let currentRole = null;
  let toolsInjected = false;

  const clientProvidedTools = Array.isArray(tools) && tools.length > 0;
  const lastUserMessageIndex = messages.reduce(
    (lastIndex, message, index) => (message?.role === ROLE.USER ? index : lastIndex),
    -1
  );

  const buildToolSpecs = () =>
    tools.map((t) => {
      const name = t.name;
      const description = t.description || `Tool: ${name}`;
      const schema = t.input_schema || {};
      const normalizedSchema =
        Object.keys(schema).length === 0
          ? { type: "object", properties: {}, required: [] }
          : { ...schema, required: schema.required ?? [] };
      return {
        toolSpecification: {
          name,
          description,
          inputSchema: { json: normalizedSchema },
        },
      };
    });

  const flushPending = () => {
    if (currentRole === ROLE.USER) {
      const content = pendingUserContent.join("\n\n").trim() || "continue";
      const userMsg = { userInputMessage: { content, modelId: model } };

      if (pendingImages.length > 0) {
        userMsg.userInputMessage.images = pendingImages;
      }
      if (pendingUserCachePoint || pendingCachePointForNextUser) {
        applyDefaultKiroCachePoint(userMsg.userInputMessage);
        pendingCachePointForNextUser = false;
      }
      if (pendingToolResults.length > 0) {
        userMsg.userInputMessage.userInputMessageContext = {
          toolResults: pendingToolResults,
        };
      }
      // Attach tools to the first user turn only.
      if (clientProvidedTools && !toolsInjected) {
        if (!userMsg.userInputMessage.userInputMessageContext) {
          userMsg.userInputMessage.userInputMessageContext = {};
        }
        userMsg.userInputMessage.userInputMessageContext.tools = buildToolSpecs();
        toolsInjected = true;
      }

      history.push(userMsg);
      currentMessage = userMsg;
      pendingUserContent = [];
      pendingToolResults = [];
      pendingImages = [];
      pendingUserCachePoint = false;
    } else if (currentRole === ROLE.ASSISTANT) {
      const content = pendingAssistantContent.join("\n\n").trim() || "...";
      history.push({ assistantResponseMessage: { content } });
      pendingAssistantContent = [];
    }
  };

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const msg = messages[messageIndex];
    const role = msg.role;
    if (role !== currentRole && currentRole !== null) flushPending();
    currentRole = role;

    if (role === ROLE.USER) {
      if (typeof msg.content === "string") {
        pendingUserContent.push(msg.content);
      } else if (Array.isArray(msg.content)) {
        const canSplitCurrentUserCache = messageIndex === lastUserMessageIndex;
        for (let blockIndex = 0; blockIndex < msg.content.length; blockIndex++) {
          const block = msg.content[blockIndex];
          const blockHasCacheControl = hasCacheControl(block);
          if (blockHasCacheControl) pendingUserCachePoint = true;

          if (typeof block === "string") {
            pendingUserContent.push(block);
          } else if (block.type === CLAUDE_BLOCK.TEXT) {
            pendingUserContent.push(block.text);
          } else if (block.type === CLAUDE_BLOCK.IMAGE && block.source?.type === "base64") {
            const mediaType = block.source.media_type || DEFAULT_IMAGE_MIME;
            const format = mediaType.split("/")[1] || mediaType;
            pendingImages.push({ format, source: { bytes: block.source.data } });
          } else if (block.type === CLAUDE_BLOCK.TOOL_RESULT) {
            let resultContent = "";
            if (typeof block.content === "string") {
              resultContent = block.content;
            } else if (Array.isArray(block.content)) {
              resultContent =
                block.content
                  .filter((c) => c.type === CLAUDE_BLOCK.TEXT)
                  .map((c) => c.text)
                  .join("\n") || JSON.stringify(block.content);
            } else if (block.content) {
              resultContent = JSON.stringify(block.content);
            }
            pendingToolResults.push({
              toolUseId: block.tool_use_id,
              status: "success",
              content: [{ text: resultContent }],
            });
          }

          if (
            canSplitCurrentUserCache &&
            blockHasCacheControl &&
            hasRenderableUserBlockAfter(msg.content, blockIndex + 1)
          ) {
            flushPending();
          }
        }
      }
    } else if (role === ROLE.ASSISTANT) {
      let textContent = "";
      const toolUses = [];
      if (typeof msg.content === "string") {
        textContent = msg.content;
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (hasCacheControl(block)) pendingCachePointForNextUser = true;
          if (block.type === CLAUDE_BLOCK.TEXT) {
            textContent += block.text;
          } else if (block.type === CLAUDE_BLOCK.TOOL_USE) {
            toolUses.push({
              toolUseId: block.id,
              name: block.name,
              input: block.input || {},
            });
          }
        }
      }
      if (textContent) pendingAssistantContent.push(textContent);

      if (toolUses.length > 0) {
        flushPending();
        const lastMsg = history[history.length - 1];
        if (lastMsg?.assistantResponseMessage) {
          lastMsg.assistantResponseMessage.toolUses = toolUses;
        }
        currentRole = null;
      }
    }
  }

  if (currentRole !== null) flushPending();

  // Pop the last user turn as currentMessage (skip trailing assistant turns).
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].userInputMessage) {
      currentMessage = history.splice(i, 1)[0];
      break;
    }
  }

  // Grab tools from the first history user turn before cleanup strips them.
  const firstHistoryTools =
    history[0]?.userInputMessage?.userInputMessageContext?.tools;

  history.forEach((item) => {
    if (item.userInputMessage?.userInputMessageContext?.tools) {
      delete item.userInputMessage.userInputMessageContext.tools;
    }
    if (
      item.userInputMessage?.userInputMessageContext &&
      Object.keys(item.userInputMessage.userInputMessageContext).length === 0
    ) {
      delete item.userInputMessage.userInputMessageContext;
    }
    if (item.userInputMessage && !item.userInputMessage.modelId) {
      item.userInputMessage.modelId = model;
    }
  });

  // Merge consecutive user turns (Kiro requires alternating roles).
  const mergedHistory = [];
  for (const current of history) {
    const prev = mergedHistory[mergedHistory.length - 1];
    if (current.userInputMessage && prev?.userInputMessage) {
      prev.userInputMessage.content += "\n\n" + current.userInputMessage.content;
      if (current.userInputMessage.cachePoint) {
        applyDefaultKiroCachePoint(prev.userInputMessage);
      }
      const prevCtx = prev.userInputMessage.userInputMessageContext;
      const curCtx = current.userInputMessage.userInputMessageContext;
      if (curCtx) {
        if (!prevCtx) {
          prev.userInputMessage.userInputMessageContext = curCtx;
        } else {
          if (curCtx.toolResults?.length > 0) {
            prevCtx.toolResults = [
              ...(prevCtx.toolResults || []),
              ...curCtx.toolResults,
            ];
          }
          if (curCtx.tools?.length > 0) {
            prevCtx.tools = [...(prevCtx.tools || []), ...curCtx.tools];
          }
        }
      }
    } else {
      mergedHistory.push(current);
    }
  }

  if (!currentMessage) {
    currentMessage = { userInputMessage: { content: "", modelId: model } };
  }

  // Inject tools into currentMessage after cleanup if not already present.
  if (
    firstHistoryTools?.length > 0 &&
    !currentMessage.userInputMessage.userInputMessageContext?.tools
  ) {
    if (!currentMessage.userInputMessage.userInputMessageContext) {
      currentMessage.userInputMessage.userInputMessageContext = {};
    }
    currentMessage.userInputMessage.userInputMessageContext.tools =
      firstHistoryTools;
  }

  return { history: mergedHistory, currentMessage };
}

/**
 * Fold orphaned toolResults (those whose toolUseId has no matching toolUse in
 * any assistant turn) back into the user text, removing the dangling
 * structured reference that makes Kiro 400.
 */
function reconcileOrphanedToolResults(history, currentMessage) {
  const validIds = new Set();
  for (const h of history) {
    const arm = h.assistantResponseMessage;
    if (!arm) continue;
    for (const tu of arm.toolUses || []) {
      if (tu.toolUseId) validIds.add(tu.toolUseId);
    }
  }

  const carriers = currentMessage ? [...history, currentMessage] : history;
  for (const item of carriers) {
    const uim = item.userInputMessage;
    const ctx = uim?.userInputMessageContext;
    if (!ctx?.toolResults?.length) continue;

    const kept = [];
    const salvaged = [];
    for (const tr of ctx.toolResults) {
      if (validIds.has(tr.toolUseId)) {
        kept.push(tr);
      } else {
        const text = Array.isArray(tr.content)
          ? tr.content.map((c) => c?.text || "").join("\n")
          : "";
        salvaged.push(`[Tool result: ${text}]`);
      }
    }

    if (salvaged.length === 0) continue;

    const extra = salvaged.join("\n");
    uim.content = uim.content ? `${uim.content}\n\n${extra}` : extra;
    ctx.toolResults = kept;
    if (kept.length === 0 && !ctx.tools?.length) {
      delete uim.userInputMessageContext;
    }
  }
}

/**
 * Build a Kiro payload directly from a Claude Messages API request body.
 */
export function claudeToKiroRequest(model, body, stream, credentials) {
  let messages = Array.isArray(body.messages) ? body.messages : [];
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const clientProvidedTools = tools.length > 0;
  const maxTokens = body.max_tokens || 32000;
  const temperature = body.temperature;
  const topP = body.top_p;

  const { upstream: upstreamModel, agentic } = resolveKiroModel(model);
  const thinkingBudget = resolveKiroThinkingBudget(body, credentials?.rawHeaders, model);
  const systemCache = splitSystemCacheControl(body.system);
  const hasCachedSystemPrefix = Boolean(systemCache.cachedText);

  // Guard 1: no client tools → flatten all tool interactions to text.
  if (!clientProvidedTools) {
    messages = flattenClaudeToolInteractions(messages);
  }

  const { history, currentMessage } = convertClaudeMessagesToKiro(
    messages,
    tools,
    upstreamModel
  );

  if (cachePointBelongsOnCurrentMessage(body)) {
    applyDefaultKiroCachePoint(currentMessage?.userInputMessage);
  }

  // Guard 2: tools present → reconcile dangling tool_results.
  if (clientProvidedTools) {
    reconcileOrphanedToolResults(history, currentMessage);
  }

  // api_key / idc / external_idp must never use the shared default ARN (belongs
  // to another account → 403 "bearer token invalid"); OAuth/social fall back to it.
  const authMethod = credentials?.providerSpecificData?.authMethod;
  const accountBoundAuth =
    authMethod === "api_key" || authMethod === "idc" || authMethod === "external_idp";
  const profileArn = accountBoundAuth
    ? (credentials?.providerSpecificData?.profileArn || "")
    : (credentials?.providerSpecificData?.profileArn || resolveDefaultProfileArn(authMethod));

  let finalContent = currentMessage?.userInputMessage?.content || "";

  // Uncached system prompts keep the existing native systemInstruction + content
  // fallback. Cached system prompts move into a history message so the cache
  // point lands before the volatile timestamp and current user text.
  let systemInstruction = undefined;
  if (systemCache.fullText) {
    if (hasCachedSystemPrefix) {
      if (systemCache.uncachedText) {
        finalContent = `${renderInstructions(systemCache.uncachedText)}\n\n${finalContent}`;
      }
    } else {
      systemInstruction = systemCache.fullText;
      finalContent = `${renderInstructions(systemCache.fullText)}\n\n${finalContent}`;
    }
  }

  // Prefix order without cached system: thinking_mode tag, timestamp marker,
  // then agentic prompt. With cached system, stable thinking/agentic/system text
  // lives before the cache point; the volatile timestamp stays current.
  const timestamp = new Date().toISOString();
  if (hasCachedSystemPrefix) {
    const cachedPrefixContent = buildCachedSystemPrefix(
      systemCache.cachedText,
      thinkingBudget,
      agentic
    );
    if (cachedPrefixContent) {
      history.unshift({
        userInputMessage: {
          content: cachedPrefixContent,
          modelId: upstreamModel,
          cachePoint: { ...KIRO_DEFAULT_CACHE_POINT },
        },
      });
    }
    finalContent = `[Context: Current time is ${timestamp}]\n\n${finalContent}`;
  } else {
    const prefixParts = [];
    if (thinkingBudget !== null) prefixParts.push(buildThinkingSystemPrefix(thinkingBudget));
    prefixParts.push(`[Context: Current time is ${timestamp}]`);
    if (agentic) prefixParts.push(KIRO_AGENTIC_SYSTEM_PROMPT);
    finalContent = `${prefixParts.join("\n\n")}\n\n${finalContent}`;
  }

  const userInputMessage = {
    content: finalContent,
    modelId: upstreamModel,
    origin: "AI_EDITOR",
    ...(currentMessage?.userInputMessage?.userInputMessageContext && {
      userInputMessageContext:
        currentMessage.userInputMessage.userInputMessageContext,
    }),
    ...(currentMessage?.userInputMessage?.images && {
      images: currentMessage.userInputMessage.images,
    }),
    ...(currentMessage?.userInputMessage?.cachePoint && {
      cachePoint: currentMessage.userInputMessage.cachePoint,
    }),
  };

  if (systemInstruction) {
    userInputMessage.systemInstruction = systemInstruction;
  }

  const payload = {
    conversationState: {
      chatTriggerType: "MANUAL",
      conversationId: resolveKiroConversationId(body, credentials),
      currentMessage: {
        userInputMessage,
      },
      history,
    },
  };

  if (profileArn) payload.profileArn = profileArn;

  if (maxTokens || temperature !== undefined || topP !== undefined) {
    payload.inferenceConfig = {};
    if (maxTokens) payload.inferenceConfig.maxTokens = maxTokens;
    if (temperature !== undefined) payload.inferenceConfig.temperature = temperature;
    if (topP !== undefined) payload.inferenceConfig.topP = topP;
  }

  // Non-enumerable hint so the executor can route the upstream model id.
  Object.defineProperty(payload, "_kiroUpstreamModel", {
    value: upstreamModel,
    enumerable: false,
  });

  return payload;
}

register(FORMATS.CLAUDE, FORMATS.KIRO, claudeToKiroRequest, null);
