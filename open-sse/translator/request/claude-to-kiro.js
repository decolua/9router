/**
 * Claude → Kiro Request Translator (DIRECT route, no OpenAI pivot)
 *
 * Converts Anthropic Messages API requests straight to Kiro / AWS
 * CodeWhisperer `GenerateAssistantResponse` payloads. This is the function the
 * direct `claude:kiro` route in ../index.js uses; it is NOT reached through the
 * claude→openai→kiro pivot.
 *
 * After session replay it delegates to the shared Kiro conversation
 * canonicalizer. That layer enforces adjacent one-to-one tool use/results,
 * repairs partial parallel calls, and flattens compacted structured references
 * that can no longer be represented safely.
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
  resolveKiroModelIntent,
  applyKiroThinkingOverride,
  resolveKiroThinkingBudget,
  buildThinkingSystemPrefix,
  KIRO_AGENTIC_SYSTEM_PROMPT,
  resolveDefaultProfileArn,
  buildKiroAdditionalModelRequestFieldsForModel,
  usesKiroNativeGptEffort,
} from "../../config/kiroConstants.js";
import { DEFAULT_IMAGE_MIME } from "../schema/index.js";
import { ROLE, CLAUDE_BLOCK } from "../schema/index.js";
import {
  canonicalizeKiroConversation,
  normalizeKiroToolSpecs,
} from "../concerns/kiroConversation.js";

/**
 * Convert Claude messages to Kiro history + currentMessage.
 * Kiro requires alternating user/assistant turns; consecutive same-role
 * messages are merged.
 */
function convertClaudeMessagesToKiro(messages, model) {
  const history = [];
  let currentMessage = null;

  let pendingUserContent = [];
  let pendingAssistantContent = [];
  let pendingToolResults = [];
  let pendingImages = [];
  let currentRole = null;

  const flushPending = () => {
    if (currentRole === ROLE.USER) {
      // Kiro's CodeWhisperer API rejects a fully-empty user `content`, so a
      // placeholder is only needed for a genuinely bare turn. When the turn
      // carries toolResults/images (the agentic tool-loop case), empty content
      // is accepted by Kiro and avoids injecting a fake "continue" user
      // instruction that the model reads as a real prompt and that leaks into
      // the visible conversation. Verified against live Kiro: a tool-result
      // turn with content:"" returns 200 and the model answers correctly.
      const text = pendingUserContent.join("\n\n").trim();
      const hasContext = pendingToolResults.length > 0 || pendingImages.length > 0;
      const content = text || (hasContext ? "" : "continue");
      const userMsg = { userInputMessage: { content, modelId: model } };

      if (pendingImages.length > 0) {
        userMsg.userInputMessage.images = pendingImages;
      }
      if (pendingToolResults.length > 0) {
        userMsg.userInputMessage.userInputMessageContext = {
          toolResults: pendingToolResults,
        };
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
              status: block.is_error ? "error" : "success",
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

  history.forEach((item) => {
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

  return { history: mergedHistory, currentMessage };
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
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const maxTokens = body.max_tokens || 32000;
  const temperature = body.temperature;
  const topP = body.top_p;

  const modelIntent = resolveKiroModelIntent(model);
  const { upstream: upstreamModel, agentic } = modelIntent;
  const thinkingBody = applyKiroThinkingOverride(body, modelIntent.thinkingOverride);
  const thinkingBudget = resolveKiroThinkingBudget(thinkingBody, credentials?.rawHeaders, modelIntent.model);
  const additionalModelRequestFields = buildKiroAdditionalModelRequestFieldsForModel(thinkingBody, upstreamModel);
  const usesNativeGptEffort = usesKiroNativeGptEffort(thinkingBody, upstreamModel);

  const { specs: toolSpecs, nameMap } = normalizeKiroToolSpecs(tools);
  const { history, currentMessage } = convertClaudeMessagesToKiro(messages, upstreamModel);

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
  if (thinkingBudget !== null && !usesNativeGptEffort) {
    systemPromptParts.push(buildThinkingSystemPrefix(thinkingBudget));
  }
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
  const canonical = canonicalizeKiroConversation({
    history: replay.history,
    currentMessage: replay.currentMessage,
    modelId: upstreamModel,
    toolSpecs,
    nameMap,
  });
  // canonicalizeKiroConversation() already ran its second-chance repair (flatten
  // every structured tool turn to text, then re-validate). A body that is STILL
  // invalid here cannot be made shippable, and Kiro answers it with
  // 400 {"message":"Improperly formed request.","reason":"REQUEST_BODY_INVALID"}.
  // Fail locally instead: chatCore turns a falsy return into a 400 without
  // spending an upstream call or a per-account cooldown. The taxonomy
  // (role:N | pair:N | id:N | spec:N | orphan:0 | current) names the offending
  // turn so the shape can be diagnosed from the log alone.
  if (!canonical.valid) {
    console.error(`[Kiro] refusing invalid conversation (claude → kiro): ${(canonical.errors || []).join(", ") || "unknown"} | turns=${(canonical.history || []).length + 1}`);
    return null;
  }
  const replayCurrent = canonical.currentMessage.userInputMessage;
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
      history: canonical.history,
    },
    agentMode: "vibe",
  };

  if (profileArn) payload.profileArn = profileArn;
  if (systemPrompt) payload.systemPrompt = systemPrompt;
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
