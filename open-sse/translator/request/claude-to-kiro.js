/**
 * Claude to Kiro Request Translator
 * Direct translation from Claude/Anthropic format to Kiro/AWS CodeWhisperer format
 * Optimized to avoid double translation through OpenAI format
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { v4 as uuidv4 } from "uuid";

/**
 * Convert Claude messages to Kiro format
 * Kiro requires alternating user/assistant messages
 */
function convertClaudeMessagesToKiro(messages, tools, model) {
  let history = [];
  let currentMessage = null;
  
  let pendingUserContent = [];
  let pendingAssistantContent = [];
  let pendingToolResults = [];
  let pendingImages = [];
  let currentRole = null;

  const flushPending = () => {
    if (currentRole === "user") {
      const content = pendingUserContent.join("\\n\\n").trim() || "continue";
      const userMsg = {
        userInputMessage: {
          content: content,
          modelId: model
        }
      };

      // Attach images if present
      if (pendingImages.length > 0) {
        userMsg.userInputMessage.images = pendingImages;
      }

      // Attach tool results
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
          const name = t.name;
          const description = t.description || `Tool: ${name}`;
          const schema = t.input_schema || {};
          
          // Normalize schema for Kiro
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
      const content = pendingAssistantContent.join("\\n\\n").trim() || "...";
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
    
    // If role changes, flush pending
    if (role !== currentRole && currentRole !== null) {
      flushPending();
    }
    currentRole = role;
    
    if (role === "user") {
      // Extract content from Claude format
      if (typeof msg.content === "string") {
        pendingUserContent.push(msg.content);
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === "text") {
            pendingUserContent.push(block.text);
          } else if (block.type === "image" && block.source?.type === "base64") {
            // Claude image format: { type: "image", source: { type: "base64", media_type, data } }
            const mediaType = block.source.media_type || "image/png";
            const format = mediaType.split("/")[1] || mediaType;
            pendingImages.push({
              format: format,
              source: { bytes: block.source.data }
            });
          } else if (block.type === "tool_result") {
            // Claude tool result: { type: "tool_result", tool_use_id, content }
            let resultContent = "";
            if (typeof block.content === "string") {
              resultContent = block.content;
            } else if (Array.isArray(block.content)) {
              resultContent = block.content
                .filter(c => c.type === "text")
                .map(c => c.text)
                .join("\\n") || JSON.stringify(block.content);
            } else if (block.content) {
              resultContent = JSON.stringify(block.content);
            }
            
            pendingToolResults.push({
              toolUseId: block.tool_use_id,
              content: resultContent
            });
          }
        }
      }
    } else if (role === "assistant") {
      // Extract content and tool_use from Claude format
      let textContent = "";
      let toolUses = [];
      
      if (typeof msg.content === "string") {
        textContent = msg.content;
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === "text") {
            textContent += block.text;
          } else if (block.type === "tool_use") {
            // Claude tool use: { type: "tool_use", id, name, input }
            toolUses.push({
              toolUseId: block.id,
              name: block.name,
              input: block.input || {}
            });
          }
        }
      }
      
      if (textContent) {
        pendingAssistantContent.push(textContent);
      }
      
      // If has tool uses, flush and attach to assistant message
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
  
  // Flush remaining
  if (currentRole !== null) {
    flushPending();
  }
  
  // Pop last userInputMessage as currentMessage
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].userInputMessage) {
      currentMessage = history.splice(i, 1)[0];
      break;
    }
  }

  // Grab tools from first history item BEFORE cleanup
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

  // Merge consecutive user messages (Kiro requires alternating)
  const mergedHistory = [];
  for (let i = 0; i < history.length; i++) {
    const current = history[i];
    if (current.userInputMessage &&
        mergedHistory.length > 0 &&
        mergedHistory[mergedHistory.length - 1].userInputMessage) {
      const prev = mergedHistory[mergedHistory.length - 1];
      prev.userInputMessage.content += "\\n\\n" + current.userInputMessage.content;
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
 * Build Kiro payload from Claude format
 */
export function claudeToKiroRequest(model, body, stream, credentials) {
  const messages = body.messages || [];
  const tools = body.tools || [];
  const maxTokens = body.max_tokens || 32000;
  const temperature = body.temperature;
  const topP = body.top_p;

  const { history, currentMessage } = convertClaudeMessagesToKiro(messages, tools, model);

  const profileArn = credentials?.providerSpecificData?.profileArn || "";

  // Inject system prompt into content if present
  let finalContent = currentMessage?.userInputMessage?.content || "";
  
  if (body.system) {
    let systemText = "";
    if (typeof body.system === "string") {
      systemText = body.system;
    } else if (Array.isArray(body.system)) {
      systemText = body.system.map(s => s.text || "").join("\\n");
    }
    
    if (systemText) {
      finalContent = `${systemText}\\n\\n${finalContent}`;
    }
  }
  
  // Add timestamp context
  const timestamp = new Date().toISOString();
  finalContent = `[Context: Current time is ${timestamp}]\\n\\n${finalContent}`;
  
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
            userInputMessageContext: currentMessage.userInputMessage.userInputMessageContext
          }),
          ...(currentMessage?.userInputMessage?.images && {
            images: currentMessage.userInputMessage.images
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

  return payload;
}

// Register translator
register(FORMATS.CLAUDE, FORMATS.KIRO, claudeToKiroRequest, null);
