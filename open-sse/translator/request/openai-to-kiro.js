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
 * Parse an OpenAI/Claude vision content part into a Kiro `images` entry.
 *
 * Accepts both Claude-style image blocks (already translated to OpenAI shape
 * upstream by `claude-to-openai`, but kept as a defensive fallback) and
 * OpenAI `image_url` blocks. Only `data:image/<fmt>;base64,...` data URLs are
 * supported \u2014 remote URLs are deliberately dropped (no synchronous network
 * fetch in the request hot path, mirroring CLIProxyAPIPlus behaviour).
 *
 * Returns `null` when the part is not an image, or when the URL is malformed
 * or non-data.
 */
function extractKiroImage(part) {
  if (!part || typeof part !== "object") return null;

  // Claude-style native image block (rare here \u2014 claude-to-openai converts these
  // to image_url before we see them, but be defensive).
  if (part.type === "image" && part.source) {
    const mediaType = part.source.media_type;
    const data = part.source.data;
    if (typeof mediaType === "string" && typeof data === "string" && mediaType && data) {
      const slashIdx = mediaType.lastIndexOf("/");
      const format = slashIdx >= 0 ? mediaType.slice(slashIdx + 1) : "";
      if (format) {
        return { format, source: { bytes: data } };
      }
    }
    return null;
  }

  // OpenAI image_url block. Either { type: "image_url", image_url: { url } } or
  // { type: "image_url", image_url: "data:..." } depending on client.
  if (part.type !== "image_url") return null;
  let url;
  if (typeof part.image_url === "string") {
    url = part.image_url;
  } else if (part.image_url && typeof part.image_url === "object") {
    url = part.image_url.url;
  }
  if (typeof url !== "string" || !url.startsWith("data:")) return null;

  const semiIdx = url.indexOf(";base64,");
  if (semiIdx < 0) return null;
  const mediaType = url.slice(5, semiIdx);            // strip "data:"
  const bytes = url.slice(semiIdx + ";base64,".length);
  if (!mediaType || !bytes) return null;

  const slashIdx = mediaType.lastIndexOf("/");
  const format = slashIdx >= 0 ? mediaType.slice(slashIdx + 1) : "";
  if (!format) return null;
  return { format, source: { bytes } };
}

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
  let pendingUserImages = [];
  let currentRole = null;

  const flushPending = () => {
    if (currentRole === "user") {
      const content = pendingUserContent.join("\n\n").trim() || "continue";
      const userMsg = {
        userInputMessage: {
          content: content,
          modelId: ""
        }
      };

      if (pendingUserImages.length > 0) {
        userMsg.userInputMessage.images = pendingUserImages;
      }

      if (pendingToolResults.length > 0) {
        userMsg.userInputMessage.userInputMessageContext = {
          toolResults: pendingToolResults
        };
      }
      
      // Add tools to first user message
      if (tools && tools.length > 0 && history.length === 0) {
        if (!userMsg.userInputMessage.userInputMessageContext) {
          userMsg.userInputMessage.userInputMessageContext = {};
        }
        userMsg.userInputMessage.userInputMessageContext.tools = tools.map(t => {
          const name = t.function?.name || t.name;
          let description = t.function?.description || t.description || "";
          
          if (!description.trim()) {
            description = `Tool: ${name}`;
          }
          
          return {
            toolSpecification: {
              name,
              description,
              inputSchema: {
                json: t.function?.parameters || t.parameters || t.input_schema || {}
              }
            }
          };
        });
      }
      
      history.push(userMsg);
      currentMessage = userMsg;
      pendingUserContent = [];
      pendingToolResults = [];
      pendingUserImages = [];
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
        const textParts = msg.content
          .filter(c => c.type === "text" || c.text)
          .map(c => c.text || "");
        content = textParts.join("\n");

        // Extract image parts (OpenAI image_url + Claude-native image blocks).
        // Only data URLs are supported; remote URLs are dropped.
        for (const c of msg.content) {
          const img = extractKiroImage(c);
          if (img) pendingUserImages.push(img);
        }

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
  
  // If last message in history is userInputMessage, use it as currentMessage
  if (history.length > 0 && history[history.length - 1].userInputMessage) {
    currentMessage = history.pop();
  }

  const firstHistoryItem = history[0];
  if (firstHistoryItem?.userInputMessage?.userInputMessageContext?.tools && 
      !currentMessage?.userInputMessage?.userInputMessageContext?.tools) {
    if (!currentMessage.userInputMessage.userInputMessageContext) {
      currentMessage.userInputMessage.userInputMessageContext = {};
    }
    currentMessage.userInputMessage.userInputMessageContext.tools = 
      firstHistoryItem.userInputMessage.userInputMessageContext.tools;
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

  return { history, currentMessage };
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

  const currentImages = currentMessage?.userInputMessage?.images;
  const payload = {
    conversationState: {
      chatTriggerType: "MANUAL",
      conversationId: uuidv4(),
      currentMessage: {
        userInputMessage: {
          content: finalContent,
          modelId: upstreamModel,
          origin: "AI_EDITOR",
          ...(Array.isArray(currentImages) && currentImages.length > 0 && {
            images: currentImages
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
