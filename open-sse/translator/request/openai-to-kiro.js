/**
 * OpenAI to Kiro Request Translator
 * Converts OpenAI Chat Completions format to Kiro/AWS CodeWhisperer format
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { v4 as uuidv4 } from "uuid";

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

  const supportsImages = true;

  const flushPending = () => {
    if (currentRole === "user") {
      const content = pendingUserContent.join("\n\n").trim() || "continue";
      const userMsg = {
        userInputMessage: {
          content: content
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

      // Add tools to first user message
      if (tools && tools.length > 0 && history.length === 0) {
        if (!userMsg.userInputMessage.userInputMessageContext) {
          userMsg.userInputMessage.userInputMessageContext = {};
        }
        userMsg.userInputMessage.userInputMessageContext.tools = tools.map(t => {
          let name = t.function?.name || t.name;
          name = sanitizeToolName(name);

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
            let name = tc.function?.name || tc.name;
            name = sanitizeToolName(name);


            if (tc.function) {
              return {
                toolUseId: tc.id || require('crypto').randomUUID(),
                name: name,
                input: typeof tc.function.arguments === "string"
                  ? JSON.parse(tc.function.arguments || "{}")
                  : (tc.function.arguments || {})
              };
            } else {
              return {
                toolUseId: tc.id || require('crypto').randomUUID(),
                name: name,
                input: typeof tc.input === "string"
                  ? JSON.parse(tc.input || "{}")
                  : (tc.input || {})
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
    // Removed modelId assignment to history.userInputMessage for Kiro API strict validation
  });

  // Merge consecutive user messages (Kiro requires alternating user/assistant)
  const mergedHistory = [];
  for (let i = 0; i < history.length; i++) {
    const current = history[i];
    if (current.userInputMessage &&
      mergedHistory.length > 0 &&
      mergedHistory[mergedHistory.length - 1].userInputMessage) {
      const prev = mergedHistory[mergedHistory.length - 1];
      prev.userInputMessage.content += "\n\n" + current.userInputMessage.content;
    } else {
      mergedHistory.push(current);
    }
  }

  // Inject tools into currentMessage AFTER cleanup
  if (firstHistoryTools && currentMessage?.userInputMessage &&
    !currentMessage.userInputMessage.userInputMessageContext?.tools) {
    if (!currentMessage.userInputMessage.userInputMessageContext) {
      currentMessage.userInputMessage.userInputMessageContext = {};
    }
    currentMessage.userInputMessage.userInputMessageContext.tools = firstHistoryTools;
  }

  return { history: mergedHistory, currentMessage };
}

/**
 * Sanitizes tool name to fit within Kiro's 64-character limit
 * and stores mapping for retrieval in the response.
 */
function sanitizeToolName(name) {
  if (!name || name.length <= 64) return name;

  const hash = require('crypto').createHash('md5').update(name).digest('hex').substring(0, 4);
  const shortName = name.substring(0, 59) + '_' + hash;

  global._kiroToolMap = global._kiroToolMap || new Map();
  global._kiroToolMap.set(shortName, name);

  return shortName;
}

/**
 * Generates a stable conversationId for multi-turn consistency.
 */
function generateStableConversationId(messages) {
  if (!messages || messages.length === 0) return uuidv4();

  const firstContent = typeof messages[0].content === "string"
    ? messages[0].content
    : JSON.stringify(messages[0].content);

  return require('crypto')
    .createHash('md5')
    .update(firstContent)
    .digest('hex')
    .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
}

const VALID_RUNTIME_MODEL_IDS = new Set([
  "auto",
  "claude-sonnet-4",
  "claude-sonnet-4.5",
  "claude-sonnet-4.6",
  "claude-opus-4.5",
  "claude-opus-4.6",
  "claude-opus-4.7",
  "claude-haiku-4.5"
]);

function toRuntimeModelId(model) {
  if (VALID_RUNTIME_MODEL_IDS.has(model)) {
    return model;
  }
  return "auto";
}

/**
 * Build Kiro payload from OpenAI format
 */
export function buildKiroPayload(model, body, stream, credentials) {
  const messages = body.messages || [];
  const tools = body.tools || [];
  const maxTokens = 32000;
  const temperature = body.temperature;
  const topP = body.top_p;

  const { history, currentMessage } = convertMessages(messages, tools, model);

  const profileArn = credentials?.providerSpecificData?.profileArn || "";

  let finalContent = currentMessage?.userInputMessage?.content || "";
  const timestamp = new Date().toISOString();
  finalContent = `[Context: Current time is ${timestamp}]\n\n${finalContent}`;

  const runtimeModelId = toRuntimeModelId(model);

  history.forEach(item => {
    if (item.userInputMessage) {
      if (!item.userInputMessage.modelId) item.userInputMessage.modelId = runtimeModelId;
      if (!item.userInputMessage.origin) item.userInputMessage.origin = "AI_EDITOR";
    }
  });

  // Stabilize conversationId for multi-turn consistency
  const conversationId = generateStableConversationId(messages);


  const payload = {
    conversationState: {
      chatTriggerType: "MANUAL",
      conversationId: conversationId,
      currentMessage: {
        userInputMessage: {
          content: finalContent,
          modelId: runtimeModelId,
          origin: "AI_EDITOR",
          ...(currentMessage?.userInputMessage?.userInputMessageContext &&
            Object.keys(currentMessage.userInputMessage.userInputMessageContext).length > 0 && {
            userInputMessageContext: currentMessage.userInputMessage.userInputMessageContext
          })
        }
      },
      history: history
    }
  };

  const DEFAULT_PROFILE_ARN = "arn:aws:codewhisperer:us-east-1:638616132270:profile/AAAACCCCXXXX";
  payload.profileArn = profileArn || DEFAULT_PROFILE_ARN;

  if (maxTokens || temperature !== undefined || topP !== undefined) {
    payload.inferenceConfig = {};
    if (maxTokens) payload.inferenceConfig.maxTokens = maxTokens;
    if (temperature !== undefined) payload.inferenceConfig.temperature = temperature;
    if (topP !== undefined) payload.inferenceConfig.topP = topP;
  }


  return payload;
}

register(FORMATS.OPENAI, FORMATS.KIRO, buildKiroPayload, null);
