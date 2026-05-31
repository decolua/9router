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
  KIRO_AGENTIC_SYSTEM_PROMPT
} from "../../config/kiroConstants.js";

/**
 * Convert OpenAI messages to Kiro format
 * Rules: system/tool/user -> user role, merge consecutive same roles
 */
function convertMessages(messages, tools, model) {
  let history = [];
  let currentMessage = null;
  
  let pendingUserContent = [];
  let pendingAssistantContent = [];
  let pendingToolResults = [];
  let pendingImages = [];
  let currentRole = null;
  let toolsAttached = false;

  // Image support is pre-filtered by caps in translateRequest before reaching here
  const supportsImages = true;

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
      
      // Add tools to the first emitted user turn. We track a flag instead of
      // relying on `history.length === 0` because the first few messages may
      // be assistant turns (e.g. when role=undefined collapses to a prior
      // assistant turn), in which case the first user flush would already see
      // a non-empty history and lose the tools schema.
      if (tools && tools.length > 0 && !toolsAttached) {
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
        toolsAttached = true;
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
          } else if (supportsImages && c.type === "image_url") {
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
          } else if (supportsImages && c.type === "image") {
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
        if (pendingAssistantContent.length === 0) {
          // pendingAssistantContent.push("Call tools");
        }
        
        // Flush to create assistant message with toolUses
        flushPending();
        
        const lastMsg = history[history.length - 1];
        if (lastMsg?.assistantResponseMessage) {
          lastMsg.assistantResponseMessage.toolUses = toolUses.map(tc => {
            if (tc.function) {
              return {
                toolUseId: tc.id || uuidv4(),
                name: tc.function.name,
                input: typeof tc.function.arguments === "string" 
                  ? JSON.parse(tc.function.arguments) 
                  : (tc.function.arguments || {})
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

  // Kiro requires currentMessage to be a user turn. If the request ends with a
  // user turn, move that final turn into currentMessage. If it ends with an
  // assistant/tool turn, keep chronological history intact and ask Kiro to
  // continue instead of reordering prior turns.
  if (history.length > 0 && history[history.length - 1].userInputMessage) {
    currentMessage = history.pop();
  } else {
    currentMessage = {
      userInputMessage: {
        content: "Continue",
        modelId: model
      }
    };
  }

  // Promote the tools schema to currentMessage. Tools may have been attached
  // to any user turn in history (e.g. when the first message was assistant or
  // had an undefined role, the first user flush lands further down). Scan the
  // whole history so we never lose the schema.
  if (!currentMessage?.userInputMessage?.userInputMessageContext?.tools) {
    const carrier = history.find(item => item?.userInputMessage?.userInputMessageContext?.tools);
    if (carrier?.userInputMessage?.userInputMessageContext?.tools) {
      if (!currentMessage.userInputMessage.userInputMessageContext) {
        currentMessage.userInputMessage.userInputMessageContext = {};
      }
      currentMessage.userInputMessage.userInputMessageContext.tools =
        carrier.userInputMessage.userInputMessageContext.tools;
    }
  }

  // Fallback: if the schema was never attached to any user turn (e.g. the
  // input contained no user messages and currentMessage is a synthesized
  // "Continue" turn), attach the provided tools directly to currentMessage so
  // Kiro still sees the schema it needs to validate assistant.toolUses in
  // history.
  if (!toolsAttached && tools && tools.length > 0 &&
      !currentMessage?.userInputMessage?.userInputMessageContext?.tools) {
    if (!currentMessage.userInputMessage.userInputMessageContext) {
      currentMessage.userInputMessage.userInputMessageContext = {};
    }
    currentMessage.userInputMessage.userInputMessageContext.tools = tools.map(t => {
      const name = t.function?.name || t.name;
      let description = t.function?.description || t.description || "";

      if (!description.trim()) {
        description = `Tool: ${name}`;
      }

      const schema = t.function?.parameters || t.parameters || t.input_schema || {};
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
    toolsAttached = true;
  }

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

  // Merge consecutive user messages (Kiro requires alternating user/assistant).
  // Concatenate text content AND merge userInputMessageContext (e.g. accumulated
  // toolResults) so we don't lose tool result history when adjacent user turns
  // collapse together — a normalized `tool` role followed by a `user` role each
  // open their own flush, producing two adjacent userInputMessage entries.
  const mergedHistory = [];
  for (let i = 0; i < history.length; i++) {
    const current = history[i];
    if (current.userInputMessage &&
        mergedHistory.length > 0 &&
        mergedHistory[mergedHistory.length - 1].userInputMessage) {
      const prev = mergedHistory[mergedHistory.length - 1];
      const prevContent = prev.userInputMessage.content || "";
      const curContent = current.userInputMessage.content || "";
      prev.userInputMessage.content = prevContent
        ? `${prevContent}\n\n${curContent}`
        : curContent;

      if (current.userInputMessage.userInputMessageContext) {
        const prevCtx = prev.userInputMessage.userInputMessageContext || {};
        const curCtx = current.userInputMessage.userInputMessageContext;
        const mergedCtx = { ...prevCtx };
        for (const [key, value] of Object.entries(curCtx)) {
          const existing = prevCtx[key];
          if (Array.isArray(existing) && Array.isArray(value)) {
            mergedCtx[key] = [...existing, ...value];
          } else {
            mergedCtx[key] = value;
          }
        }
        prev.userInputMessage.userInputMessageContext = mergedCtx;
      }
    } else {
      mergedHistory.push(current);
    }
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
  let tools = body.tools || [];
  const maxTokens = 32000;
  const temperature = body.temperature;
  const topP = body.top_p;

  const { upstream: upstreamModel, agentic, thinking: modelImpliesThinking } = resolveKiroModel(model);
  const thinkingEnabled = modelImpliesThinking || isThinkingEnabled(body, null, model);

  // Kiro rejects history that references toolUses/toolResults without a tools
  // schema in userInputMessageContext. When callers omit body.tools but the
  // message history still contains assistant.tool_calls / role=tool turns,
  // synthesize a minimal tool schema from the tool names present in history
  // so Kiro accepts the request instead of returning `Improperly formed
  // request`. This preserves tool-call history and is a no-op when body.tools
  // is already populated.
  if (tools.length === 0) {
    const seen = new Set();
    const synthesized = [];
    const pushName = (name) => {
      if (typeof name === "string" && name && !seen.has(name)) {
        seen.add(name);
        synthesized.push({
          type: "function",
          function: {
            name,
            description: `Tool: ${name}`,
            parameters: { type: "object", properties: {}, required: [] }
          }
        });
      }
    };
    for (const msg of messages) {
      if (msg?.role !== "assistant") continue;
      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          pushName(tc?.function?.name || tc?.name);
        }
      }
      // Anthropic-style assistant blocks: content:[{type:"tool_use", name, ...}]
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block?.type === "tool_use") {
            pushName(block.name);
          }
        }
      }
    }
    if (synthesized.length > 0) {
      tools = synthesized;
    }
  }

  const { history, currentMessage } = convertMessages(messages, tools, upstreamModel);

  const profileArn = credentials?.providerSpecificData?.profileArn || "";

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
