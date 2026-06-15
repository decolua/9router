/**
 * OpenAI to Kiro Request Translator
 * Converts OpenAI Chat Completions format to Kiro/AWS CodeWhisperer format
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { v4 as uuidv4 } from "uuid";
import {
  resolveKiroModel,
  isThinkingEnabled,
  buildThinkingSystemPrefix,
  KIRO_AGENTIC_SYSTEM_PROMPT,
  resolveDefaultProfileArn
} from "../../config/kiroConstants.js";

/** Render a single tool call as a readable text line. */
function toolCallToText(name, input) {
  let argStr;
  try {
    argStr = typeof input === "string" ? input : JSON.stringify(input ?? {});
  } catch {
    argStr = "{}";
  }
  return `[Tool call: ${name || "unknown"}(${argStr})]`;
}

/** Render a tool result (string or content-block array) as a text line. */
function toolResultToText(content) {
  const text = Array.isArray(content)
    ? content.map(c => (typeof c === "string" ? c : c.text || "")).join("\n")
    : (typeof content === "string" ? content : "");
  return `[Tool result: ${text}]`;
}

/**
 * Flatten all tool calls/results in a conversation into plain text.
 *
 * Kiro's schema validator requires a non-empty
 * currentMessage.userInputMessageContext.tools array whenever the history
 * references any tool use; otherwise it returns "Improperly formed request"
 * (HTTP 400). A client can hit this by omitting the `tools` array on a
 * follow-up request — typically after client-side compaction (e.g. OpenCode).
 *
 * Rather than fabricate stub tool specs — which would advertise tool-calling
 * capability the client never requested and may not handle, risking a phantom
 * tool call on an otherwise plain turn — we collapse the tool interaction into
 * text. The request stays honest, and since no structured tool content
 * remains, the validator's "tools required" rule never fires.
 *
 * Only invoked when the client did NOT send tools; when tools are present the
 * structured form is preserved.
 */
function flattenToolInteractions(messages) {
  const out = [];

  for (const msg of messages) {
    // OpenAI tool-result message → user text line
    if (msg.role === "tool") {
      out.push({ role: "user", content: toolResultToText(msg.content) });
      continue;
    }

    if (msg.role === "assistant") {
      const parts = [];
      if (Array.isArray(msg.content)) {
        for (const c of msg.content) {
          if (c.type === "tool_use") {
            parts.push(toolCallToText(c.name, c.input));
          } else if (c.type === "text" || c.text) {
            parts.push(c.text || "");
          }
        }
      } else if (typeof msg.content === "string") {
        parts.push(msg.content);
      }
      for (const tc of msg.tool_calls || []) {
        parts.push(toolCallToText(tc.function?.name, tc.function?.arguments));
      }
      out.push({ role: "assistant", content: parts.filter(Boolean).join("\n") });
      continue;
    }

    // User messages: replace tool_result blocks with text, keep text + images.
    if (msg.role === "user" && Array.isArray(msg.content)) {
      const newContent = msg.content.map(c =>
        c.type === "tool_result"
          ? { type: "text", text: toolResultToText(c.content) }
          : c
      );
      out.push({ ...msg, content: newContent });
      continue;
    }

    out.push(msg);
  }

  return out;
}

/**
 * Reconcile orphaned toolResults — those whose toolUseId has no matching
 * toolUse in any assistant message. This happens when client-side compaction
 * truncates the conversation and removes the assistant message containing the
 * tool_use, but keeps the user message with the corresponding tool_result.
 *
 * A dangling structured reference makes Kiro return 400, so it must be removed.
 * But the client deliberately kept the result content through compaction, so
 * rather than discard it we fold it back into the user message as text — the
 * same shape flattenToolInteractions() produces. The 400 trigger (the
 * structured reference) is gone; the content survives.
 *
 * `messages` is every carrier that can hold toolResults — both history items
 * and the popped-out currentMessage (orphans can land on either).
 */
function reconcileOrphanedToolResults(history, currentMessage) {
  // Phase 1: collect all valid toolUseIds from assistant messages in history.
  // (currentMessage is always a user turn, so it carries no toolUses.)
  const validIds = new Set();
  for (const h of history) {
    const arm = h.assistantResponseMessage;
    if (!arm) continue;
    for (const tu of arm.toolUses || []) {
      if (tu.toolUseId) validIds.add(tu.toolUseId);
    }
  }

  // Phase 2: across history + currentMessage, keep results with a matching
  // toolUse and salvage the rest as text.
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
        salvaged.push(toolResultToText(tr.content));
      }
    }

    if (salvaged.length === 0) continue; // no orphans — leave untouched

    // Fold orphaned result content into the user text so it is not lost
    const extra = salvaged.join("\n");
    uim.content = uim.content ? `${uim.content}\n\n${extra}` : extra;

    ctx.toolResults = kept;
    if (kept.length === 0 && !ctx.tools?.length) {
      delete uim.userInputMessageContext;
    }
  }
}

/**
 * Safely parse JSON string, returning fallback on failure.
 */
function safeJSONParse(str, fallback) {
  if (typeof str !== "string") return str ?? fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

/**
 * Convert OpenAI messages to Kiro format
 * Rules: system/tool/user -> user role, merge consecutive same roles.
 *
 * Returns { history, currentMessage }.
 */
function convertMessages(messages, tools, model) {
  let history = [];
  let currentMessage = null;

  const clientProvidedTools = tools && tools.length > 0;

  // When the client did not send tools, flatten any tool calls/results in the
  // history into plain text (see flattenToolInteractions). This keeps the
  // request honest and sidesteps Kiro's "tools required" 400, since no
  // structured tool content survives to trigger it.
  if (!clientProvidedTools) {
    messages = flattenToolInteractions(messages);
  }

  let pendingUserContent = [];
  let pendingAssistantContent = [];
  let pendingToolResults = [];
  let pendingImages = [];
  let currentRole = null;
  let toolsInjectedToFirstUserMsg = false;

  const flushPending = () => {
    if (currentRole === "user") {
      const content = pendingUserContent.join("\n\n").trim() || "continue";
      const userMsg = {
        userInputMessage: {
          content: content,
          modelId: ""
        }
      };

      // Attach images if present (Kiro API supports images field)
      if (pendingImages.length > 0) {
        userMsg.userInputMessage.images = pendingImages;
      }

      if (pendingToolResults.length > 0) {
        userMsg.userInputMessage.userInputMessageContext = {
          toolResults: pendingToolResults
        };
      }

      // Add tools to the user message that has no preceding assistant messages,
      // OR the first user message (whichever comes first after any opening
      // assistant messages). We track whether any user message has already
      // received tools via a flag on the history array.
      if (clientProvidedTools && !toolsInjectedToFirstUserMsg) {
        if (!userMsg.userInputMessage.userInputMessageContext) {
          userMsg.userInputMessage.userInputMessageContext = {};
        }
        userMsg.userInputMessage.userInputMessageContext.tools = tools.map(t => {
          const name = t.function?.name || t.name;
          let description = t.function?.description || t.description || "";

          if (!description.trim()) {
            description = `Tool: ${name}`;
          }

          const schema = t.function?.parameters || t.parameters || t.input_schema || {};
          // Normalize schema: Kiro requires required[] and proper type/properties
          const normalizedSchema = Object.keys(schema).length === 0
            ? { type: "object", properties: {}, required: [] }
            : { ...schema, required: schema.required ?? [] };

          return {
            toolSpecification: {
              name,
              description,
              inputSchema: { json: normalizedSchema }
            }
          };
        });
        toolsInjectedToFirstUserMsg = true;
      }

      history.push(userMsg);
      currentMessage = userMsg;
      pendingUserContent = [];
      pendingToolResults = [];
      pendingImages = [];
    } else if (currentRole === "assistant") {
      const content = pendingAssistantContent.join("\n\n").trim() || "...";
      const assistantMsg = {
        assistantResponseMessage: {
          content: content
        }
      };
      history.push(assistantMsg);
      pendingAssistantContent = [];
    }
  };

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    let role = msg.role;

    // Normalize: system/tool -> user
    if (role === "system" || role === "tool") {
      role = "user";
    }

    // If role changes, flush pending
    if (role !== currentRole && currentRole !== null) {
      flushPending();
    }
    currentRole = role;

    if (role === "user") {
      // Extract content
      let content = "";
      if (typeof msg.content === "string") {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        const textParts = [];
        for (const c of msg.content) {
          if (c.type === "text" || c.text) {
            textParts.push(c.text || "");
          } else if (c.type === "image_url") {
            // OpenAI format: image_url.url with data URI
            const url = c.image_url?.url || "";
            const base64Match = url.match(/^data:([^;]+);base64,(.+)$/);
            if (base64Match) {
              const mediaType = base64Match[1];
              const format = mediaType.split("/")[1] || mediaType;
              pendingImages.push({ format, source: { bytes: base64Match[2] } });
            } else if (url.startsWith("http://") || url.startsWith("https://")) {
              // Kiro only supports base64 — fallback to URL text
              textParts.push(`[Image: ${url}]`);
            }
          } else if (c.type === "image") {
            // Claude format: source.type = "base64", source.media_type, source.data
            if (c.source?.type === "base64" && c.source?.data) {
              const mediaType = c.source.media_type || "image/png";
              const format = mediaType.split("/")[1] || mediaType;
              pendingImages.push({ format, source: { bytes: c.source.data } });
            }
          }
        }
        content = textParts.join("\n");

        // Check for tool_result blocks
        const toolResultBlocks = msg.content.filter(c => c.type === "tool_result");
        if (toolResultBlocks.length > 0) {
          toolResultBlocks.forEach(block => {
            const text = Array.isArray(block.content)
              ? block.content.map(c => c.text || "").join("\n")
              : (typeof block.content === "string" ? block.content : "");

            pendingToolResults.push({
              toolUseId: block.tool_use_id,
              status: "success",
              content: [{ text: text }]
            });
          });
        }
      }

      // Handle tool role (from normalized)
      if (msg.role === "tool") {
        const toolContent = typeof msg.content === "string" ? msg.content : "";
        pendingToolResults.push({
          toolUseId: msg.tool_call_id,
          status: "success",
          content: [{ text: toolContent }]
        });
      } else if (content) {
        pendingUserContent.push(content);
      }
    } else if (role === "assistant") {
      // Extract text content and tool uses
      let textContent = "";
      let toolUses = [];

      if (Array.isArray(msg.content)) {
        const textBlocks = msg.content.filter(c => c.type === "text");
        textContent = textBlocks.map(b => b.text).join("\n").trim();

        const toolUseBlocks = msg.content.filter(c => c.type === "tool_use");
        toolUses = toolUseBlocks;
      } else if (typeof msg.content === "string") {
        textContent = msg.content.trim();
      }

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        toolUses = msg.tool_calls;
      }

      if (textContent) {
        pendingAssistantContent.push(textContent);
      }

      // Store tool uses in last assistant message
      if (toolUses.length > 0) {
        // Flush to create assistant message with toolUses
        flushPending();

        const lastMsg = history[history.length - 1];
        if (lastMsg?.assistantResponseMessage) {
          lastMsg.assistantResponseMessage.toolUses = toolUses.map(tc => {
            if (tc.function) {
              return {
                toolUseId: tc.id || uuidv4(),
                name: tc.function.name,
                input: safeJSONParse(tc.function.arguments, {})
              };
            } else {
              return {
                toolUseId: tc.id || uuidv4(),
                name: tc.name,
                input: tc.input || {}
              };
            }
          });
        }

        currentRole = null;
      }
    }
  }

  // Flush remaining
  if (currentRole !== null) {
    flushPending();
  }

  // Pop last userInputMessage as currentMessage (search from end, skip trailing assistant messages)
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].userInputMessage) {
      currentMessage = history.splice(i, 1)[0];
      break;
    }
  }

  // Grab tools from first history item BEFORE cleanup removes them
  const firstHistoryTools = history[0]?.userInputMessage?.userInputMessageContext?.tools;

  // Clean up history for Kiro API compatibility
  history.forEach(item => {
    if (item.userInputMessage?.userInputMessageContext?.tools) {
      delete item.userInputMessage.userInputMessageContext.tools;
    }
    if (item.userInputMessage?.userInputMessageContext &&
        Object.keys(item.userInputMessage.userInputMessageContext).length === 0) {
      delete item.userInputMessage.userInputMessageContext;
    }
    if (item.userInputMessage && !item.userInputMessage.modelId) {
      item.userInputMessage.modelId = model;
    }
  });

  // Merge consecutive user messages (Kiro requires alternating user/assistant)
  // When merging, also combine userInputMessageContext fields so toolResults
  // and images from the second message are not silently dropped.
  const mergedHistory = [];
  for (let i = 0; i < history.length; i++) {
    const current = history[i];
    if (current.userInputMessage &&
        mergedHistory.length > 0 &&
        mergedHistory[mergedHistory.length - 1].userInputMessage) {
      const prev = mergedHistory[mergedHistory.length - 1];
      prev.userInputMessage.content += "\n\n" + current.userInputMessage.content;
      // Merge context: combine toolResults, images, etc.
      const prevCtx = prev.userInputMessage.userInputMessageContext;
      const curCtx = current.userInputMessage.userInputMessageContext;
      if (curCtx) {
        if (!prevCtx) {
          prev.userInputMessage.userInputMessageContext = curCtx;
        } else {
          if (curCtx.toolResults?.length > 0) {
            prevCtx.toolResults = [...(prevCtx.toolResults || []), ...curCtx.toolResults];
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

  // When currentMessage is null (no user messages at all — edge case where
  // input is only assistant messages), create a minimal currentMessage so
  // tools and content can be injected.
  if (!currentMessage) {
    currentMessage = {
      userInputMessage: {
        content: "",
        modelId: model,
      }
    };
  }

  // Reconcile orphaned toolResults across history AND currentMessage — when
  // client-side compaction removes assistant messages containing tool_use but
  // keeps the tool_result, the dangling reference triggers a Kiro 400. Fold the
  // content back into the user text instead of discarding it. Run after
  // currentMessage is finalized (an orphan can be merged into it) and before
  // tool injection (which may re-add userInputMessageContext).
  //
  // Only needed on the tools-present path: when the client sent no tools,
  // flattenToolInteractions already collapsed every toolResult to text, so
  // there is nothing structured left to orphan.
  if (clientProvidedTools) {
    reconcileOrphanedToolResults(mergedHistory, currentMessage);
  }

  // Inject tools into currentMessage AFTER cleanup. Tools only exist here when
  // the client explicitly sent them (otherwise flattenToolInteractions already
  // collapsed all tool content to text upstream, so there is nothing to carry).
  const resolvedTools = firstHistoryTools;

  if (resolvedTools?.length > 0 &&
      !currentMessage.userInputMessage.userInputMessageContext?.tools) {
    if (!currentMessage.userInputMessage.userInputMessageContext) {
      currentMessage.userInputMessage.userInputMessageContext = {};
    }
    currentMessage.userInputMessage.userInputMessageContext.tools = resolvedTools;
  }

  return { history: mergedHistory, currentMessage };
}

/**
 * Build Kiro payload from OpenAI format
 *
 * Two 9router-specific behaviours implemented here:
 *
 * 1. `-agentic` model suffix. Synthetic variant — same upstream model, but we
 *    inject a chunked-write system prompt to keep large file writes under
 *    Kiro's 2-3 minute server timeout. The suffix is stripped before being
 *    sent upstream.
 *
 * 2. Thinking / reasoning. Kiro does not accept `thinking.type` or
 *    `reasoning_effort` natively. The only way to enable reasoning is to
 *    inject `<thinking_mode>enabled</thinking_mode>` into the user content
 *    sent upstream. Detection covers Anthropic-Beta header, Claude API
 *    `thinking`, OpenAI `reasoning_effort`, AMP/Cursor magic tags, and model
 *    name hints.
 */
export function buildKiroPayload(model, body, stream, credentials) {
  const messages = body.messages || [];
  const tools = body.tools || [];
  const maxTokens = 32000;
  const temperature = body.temperature;
  const topP = body.top_p;

  const { upstream: upstreamModel, agentic, thinking: modelImpliesThinking } = resolveKiroModel(model);
  const thinkingEnabled = modelImpliesThinking || isThinkingEnabled(body, null, model);

  const { history, currentMessage } = convertMessages(messages, tools, upstreamModel);

  const profileArn = credentials?.providerSpecificData?.profileArn
    || resolveDefaultProfileArn(credentials?.providerSpecificData?.authMethod);

  let finalContent = currentMessage?.userInputMessage?.content || "";

  const timestamp = new Date().toISOString();

  // Build the system-prompt prefix that goes ABOVE the user message body.
  // Order: thinking_mode tag first (so Kiro sees it before any user text),
  // then context/timestamp marker, then optional agentic chunked-write prompt.
  const prefixParts = [];
  if (thinkingEnabled) {
    prefixParts.push(buildThinkingSystemPrefix());
  }
  prefixParts.push(`[Context: Current time is ${timestamp}]`);
  if (agentic) {
    prefixParts.push(KIRO_AGENTIC_SYSTEM_PROMPT);
  }
  finalContent = `${prefixParts.join("\n\n")}\n\n${finalContent}`;

  const payload = {
    conversationState: {
      chatTriggerType: "MANUAL",
      conversationId: uuidv4(),
      currentMessage: {
        userInputMessage: {
          content: finalContent,
          modelId: upstreamModel,
          origin: "AI_EDITOR",
          ...(currentMessage?.userInputMessage?.images?.length > 0 && {
            images: currentMessage.userInputMessage.images
          }),
          ...(currentMessage?.userInputMessage?.userInputMessageContext && {
            userInputMessageContext: currentMessage.userInputMessage.userInputMessageContext
          })
        }
      },
      history: history
    }
  };

  if (profileArn) {
    payload.profileArn = profileArn;
  }

  if (maxTokens || temperature !== undefined || topP !== undefined) {
    payload.inferenceConfig = {};
    if (maxTokens) payload.inferenceConfig.maxTokens = maxTokens;
    if (temperature !== undefined) payload.inferenceConfig.temperature = temperature;
    if (topP !== undefined) payload.inferenceConfig.topP = topP;
  }

  // Tag payload so the executor can route the upstream model id correctly.
  Object.defineProperty(payload, "_kiroUpstreamModel", {
    value: upstreamModel,
    enumerable: false
  });

  return payload;
}

register(FORMATS.OPENAI, FORMATS.KIRO, buildKiroPayload, null);
