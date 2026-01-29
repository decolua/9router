/**
 * OpenAI to Kiro Request Translator
 * Converts OpenAI Chat Completions format to Kiro/AWS CodeWhisperer format
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { v4 as uuidv4 } from "uuid";

/**
 * Convert OpenAI messages to Kiro format
 */
function convertMessages(messages, tools, model) {
  let history = [];
  let currentMessage = null;
  let systemPrompt = "";

  const toolResultsMap = new Map();

  for (const msg of messages) {
    if (msg.role === "tool" && msg.tool_call_id) {
      const content =
        typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content.map((c) => c.text || "").join("\n")
            : "";
      toolResultsMap.set(msg.tool_call_id, content);
    }

    if (msg.role === "user" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "tool_result" && block.tool_use_id) {
          const content = Array.isArray(block.content)
            ? block.content.map((c) => c.text || "").join("\n")
            : typeof block.content === "string"
              ? block.content
              : "";
          toolResultsMap.set(block.tool_use_id, content);
        }
      }
    }
  }

  for (const msg of messages) {
    const role = msg.role;

    if (role === "tool") continue;

    const content =
      typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map((c) => c.text || "").join("\n")
          : "";

    if (role === "system") {
      systemPrompt += (systemPrompt ? "\n" : "") + content;
      continue;
    }

    if (role === "user") {
      let finalContent = content;
      let toolResults = [];

      // Check if this user message contains tool_result blocks
      if (Array.isArray(msg.content)) {
        const toolResultBlocks = msg.content.filter((c) => c.type === "tool_result");
        if (toolResultBlocks.length > 0) {
          toolResults = toolResultBlocks.map((block) => {
            const text = Array.isArray(block.content)
              ? block.content.map((c) => c.text || "").join("\n")
              : typeof block.content === "string"
                ? block.content
                : "";

            return {
              toolUseId: block.tool_use_id,
              status: "success",
              content: [{ text: text }],
            };
          });

          // Set simple content when tool results exist
          finalContent = content || "Continue";
        }
      }

      const userMsg = {
        userInputMessage: {
          content: finalContent,
          modelId: "",
        },
      };

      // Add tool results to userInputMessageContext
      if (toolResults.length > 0) {
        if (!userMsg.userInputMessage.userInputMessageContext) {
          userMsg.userInputMessage.userInputMessageContext = {};
        }
        userMsg.userInputMessage.userInputMessageContext.toolResults = toolResults;
      }

      // Add tools to first user message
      if (tools && tools.length > 0 && history.length === 0) {
        if (!userMsg.userInputMessage.userInputMessageContext) {
          userMsg.userInputMessage.userInputMessageContext = {};
        }
        userMsg.userInputMessage.userInputMessageContext.tools = tools.map((t) => {
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
                json: t.function?.parameters || t.parameters || t.input_schema || {},
              },
            },
          };
        });
      }

      currentMessage = userMsg;
      history.push(userMsg);
    }

    if (role === "assistant") {
      // Extract text content and tool uses separately from content array
      let textContent = "";
      let toolUses = [];

      if (Array.isArray(msg.content)) {
        const textBlocks = msg.content.filter((c) => c.type === "text");
        textContent = textBlocks
          .map((b) => b.text)
          .join("\n")
          .trim();

        const toolUseBlocks = msg.content.filter((c) => c.type === "tool_use");
        toolUses = toolUseBlocks;
      } else if (typeof msg.content === "string") {
        textContent = msg.content.trim();
      }

      // Fallback for OpenAI tool_calls format
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        toolUses = msg.tool_calls;
      }

      const assistantMsg = {
        assistantResponseMessage: {
          content: textContent || "Call tools",
        },
      };

      if (toolUses.length > 0) {
        assistantMsg.assistantResponseMessage.toolUses = toolUses.map((tc) => {
          if (tc.function) {
            // OpenAI format
            return {
              toolUseId: tc.id || uuidv4(),
              name: tc.function.name,
              input:
                typeof tc.function.arguments === "string"
                  ? JSON.parse(tc.function.arguments)
                  : tc.function.arguments || {},
            };
          } else {
            // Anthropic format
            return {
              toolUseId: tc.id || uuidv4(),
              name: tc.name,
              input: tc.input || {},
            };
          }
        });
      }

      history.push(assistantMsg);
    }
  }

  // If last message in history is userInputMessage, use it as currentMessage
  if (history.length > 0 && history[history.length - 1].userInputMessage) {
    currentMessage = history.pop();
  }

  const firstHistoryItem = history[0];
  if (
    firstHistoryItem?.userInputMessage?.userInputMessageContext?.tools &&
    !currentMessage?.userInputMessage?.userInputMessageContext?.tools
  ) {
    if (!currentMessage.userInputMessage.userInputMessageContext) {
      currentMessage.userInputMessage.userInputMessageContext = {};
    }
    currentMessage.userInputMessage.userInputMessageContext.tools =
      firstHistoryItem.userInputMessage.userInputMessageContext.tools;
  }

  // Clean up history for Kiro API compatibility
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

  // Merge consecutive user messages (Kiro requires alternating user/assistant)
  const mergedHistory = [];
  for (let i = 0; i < history.length; i++) {
    const current = history[i];

    if (
      current.userInputMessage &&
      mergedHistory.length > 0 &&
      mergedHistory[mergedHistory.length - 1].userInputMessage
    ) {
      const prev = mergedHistory[mergedHistory.length - 1];
      prev.userInputMessage.content += "\n\n" + current.userInputMessage.content;
    } else {
      mergedHistory.push(current);
    }
  }
  history = mergedHistory;

  return { history, currentMessage, systemPrompt };
}

/**
 * Build Kiro payload from OpenAI format
 */
function buildKiroPayload(model, body, stream, credentials) {
  const messages = body.messages || [];
  const tools = body.tools || [];
  const maxTokens = 32000;
  const temperature = body.temperature;
  const topP = body.top_p;

  const { history, currentMessage, systemPrompt } = convertMessages(messages, tools, model);

  const profileArn = credentials?.providerSpecificData?.profileArn || "";

  let finalContent = currentMessage?.userInputMessage?.content || "";
  if (systemPrompt) {
    finalContent = `[System: ${systemPrompt}]\n\n${finalContent}`;
  }

  const timestamp = new Date().toISOString();
  finalContent = `[Context: Current time is ${timestamp}]\n\n${finalContent}`;

  const payload = {
    conversationState: {
      chatTriggerType: "MANUAL",
      conversationId: uuidv4(),
      currentMessage: {
        userInputMessage: {
          content: finalContent,
          modelId: model,
          origin: "AI_EDITOR",
          ...(currentMessage?.userInputMessage?.userInputMessageContext && {
            userInputMessageContext: currentMessage.userInputMessage.userInputMessageContext,
          }),
        },
      },
      history: history,
    },
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

  return payload;
}

register(FORMATS.OPENAI, FORMATS.KIRO, buildKiroPayload, null);

export { buildKiroPayload };
