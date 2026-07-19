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
import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { applyKiroSessionReplay } from "../../utils/kiroSessionReplay.js";
import { resolveContinuationId, resolveSessionIdentity } from "../../utils/sessionManager.js";
import {
  resolveKiroModel,
  resolveKiroThinkingBudget,
  buildThinkingSystemPrefix,
  KIRO_AGENTIC_SYSTEM_PROMPT,
  resolveDefaultProfileArn,
  buildKiroAdditionalModelRequestFieldsForModel,
} from "../../config/kiroConstants.js";
import { DEFAULT_IMAGE_MIME } from "../schema/index.js";
import { ROLE, CLAUDE_BLOCK } from "../schema/index.js";

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
          ? { type: CLAUDE_BLOCK.TEXT, text: toolResultBlockToText(block.content) }
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
  let currentRole = null;
  let toolsInjected = false;

  const clientProvidedTools = Array.isArray(tools) && tools.length > 0;

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
    } else if (currentRole === ROLE.ASSISTANT) {
      const content = pendingAssistantContent.join("\n\n").trim() || "...";
      history.push({ assistantResponseMessage: { content } });
      pendingAssistantContent = [];
    }
  };

  for (const msg of messages) {
    const role = msg.role;
    if (role !== currentRole && currentRole !== null) flushPending();
    currentRole = role;

    if (role === ROLE.USER) {
      if (typeof msg.content === "string") {
        pendingUserContent.push(msg.content);
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === CLAUDE_BLOCK.TEXT) {
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
        }
      }
    } else if (role === ROLE.ASSISTANT) {
      let textContent = "";
      const toolUses = [];
      if (typeof msg.content === "string") {
        textContent = msg.content;
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
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

function extractClaudeSystemText(system) {
  if (!system) return "";
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return system.map((s) => {
      if (typeof s === "string") return s;
      return s?.text || "";
    }).filter(Boolean).join("\n");
  }
  return "";
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

  // Guard 1: no client tools → flatten all tool interactions to text.
  if (!clientProvidedTools) {
    messages = flattenClaudeToolInteractions(messages);
  }

  const { history, currentMessage } = convertClaudeMessagesToKiro(
    messages,
    tools,
    upstreamModel
  );

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

  // Kiro CLI/KAS sends system prompt as top-level `systemPrompt`. Keep a
  // content fallback too because the CodeWhisperer surface does not always
  // enforce top-level systemPrompt for direct calls.
  const timestamp = new Date().toISOString();
  const systemPromptParts = [];
  if (thinkingBudget !== null) systemPromptParts.push(buildThinkingSystemPrefix(thinkingBudget));
  if (agentic) systemPromptParts.push(KIRO_AGENTIC_SYSTEM_PROMPT);
  const systemInstruction = extractClaudeSystemText(body.system);
  if (systemInstruction) systemPromptParts.push(systemInstruction);
  const systemPrompt = systemPromptParts.filter(Boolean).join("\n\n");
  const currentTimeContext = `[Context: Current time is ${timestamp}]`;
  const contentPrefix = [systemPrompt, currentTimeContext].filter(Boolean).join("\n\n");

  const sessionIdentity = resolveSessionIdentity({
    headers: credentials?.rawHeaders,
    body,
    connectionId: credentials?.connectionId,
    scope: "kiro",
  });
  const conversationId = sessionIdentity.sessionId;
  const continuationId = resolveContinuationId({
    sessionId: conversationId,
    connectionId: credentials?.connectionId,
    scope: "kiro",
    ephemeral: sessionIdentity.ephemeral,
  });
  const replay = applyKiroSessionReplay({
    conversationId,
    connectionId: credentials?.connectionId,
    modelId: upstreamModel,
    systemPrompt,
    contentPrefix,
    currentContentPrefix: currentTimeContext,
    history,
    currentMessage,
  });
  const replayCurrent = replay.currentMessage?.userInputMessage || {};
  const userInputMessage = {
    content: replayCurrent.content || "",
    modelId: upstreamModel,
    origin: "AI_EDITOR",
    ...(replayCurrent.userInputMessageContext && {
      userInputMessageContext: replayCurrent.userInputMessageContext,
    }),
    ...(replayCurrent.images && {
      images: replayCurrent.images,
    }),
  };

  const payload = {
    conversationState: {
      chatTriggerType: "MANUAL",
      conversationId,
      agentContinuationId: continuationId,
      agentTaskType: "vibe",
      currentMessage: {
        userInputMessage,
      },
      history: replay.history,
    },
    agentMode: "vibe",
  };

  if (profileArn) payload.profileArn = profileArn;
  if (systemPrompt) payload.systemPrompt = systemPrompt;
  const additionalModelRequestFields = buildKiroAdditionalModelRequestFieldsForModel(body, upstreamModel);
  if (additionalModelRequestFields) {
    payload.additionalModelRequestFields = additionalModelRequestFields;
  }

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
