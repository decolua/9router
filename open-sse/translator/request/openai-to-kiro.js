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
      const content = typeof msg.content === "string" ? msg.content : 
        (Array.isArray(msg.content) ? msg.content.map(c => c.text || "").join("\n") : "");
      toolResultsMap.set(msg.tool_call_id, content);
    }
    
    if (msg.role === "user" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "tool_result" && block.tool_use_id) {
          const content = Array.isArray(block.content) 
            ? block.content.map(c => c.text || "").join("\n")
            : (typeof block.content === "string" ? block.content : "");
          toolResultsMap.set(block.tool_use_id, content);
        }
      }
    }
  }

  for (const msg of messages) {
    const role = msg.role;
    
    if (role === "tool") continue;
    
    const content = typeof msg.content === "string" ? msg.content : 
      (Array.isArray(msg.content) ? msg.content.map(c => c.text || "").join("\n") : "");

    if (role === "system") {
      systemPrompt += (systemPrompt ? "\n" : "") + content;
      continue;
    }

    if (role === "user") {
      // Skip user messages with only tool_result blocks (Kiro API doesn't support tool results)
      if (Array.isArray(msg.content)) {
        const hasOnlyToolResults = msg.content.every(c => c.type === "tool_result");
        if (hasOnlyToolResults) {
          continue;
        }
      }
      
      const userMsg = {
        userInputMessage: {
          content: content,
          modelId: "",
          origin: "AI_EDITOR"
        }
      };

      if (tools && tools.length > 0 && history.length === 0) {
        userMsg.userInputMessage.userInputMessageContext = {
          tools: tools.map(t => {
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
          })
        };
      }

      currentMessage = userMsg;
      history.push(userMsg);
    }

    if (role === "assistant") {
      const assistantMsg = {
        assistantResponseMessage: {
          content: content
        }
      };

      const toolCallsOrUses = msg.tool_calls || 
        (Array.isArray(msg.content) ? msg.content.filter(c => c.type === "tool_use") : []);
      
      if (toolCallsOrUses.length > 0) {
        assistantMsg.assistantResponseMessage.toolUses = toolCallsOrUses.map(tc => {
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
        
        const toolResults = [];
        for (const tc of toolCallsOrUses) {
          const toolId = tc.id;
          const toolResult = toolResultsMap.get(toolId);
          if (toolResult !== undefined) {
            toolResults.push({
              content: [{ text: toolResult }],
              status: "success",
              toolUseId: toolId
            });
          }
        }
        
        if (toolResults.length > 0) {
          assistantMsg._pendingToolResults = toolResults;
        }
      }

      history.push(assistantMsg);
    }
  }
  
  for (let i = 0; i < history.length; i++) {
    if (history[i].assistantResponseMessage?._pendingToolResults) {
      const toolResults = history[i].assistantResponseMessage._pendingToolResults;
      delete history[i].assistantResponseMessage._pendingToolResults;
      
      for (let j = i + 1; j < history.length; j++) {
        if (history[j].userInputMessage) {
          if (!history[j].userInputMessage.userInputMessageContext) {
            history[j].userInputMessage.userInputMessageContext = {};
          }
          history[j].userInputMessage.userInputMessageContext.toolResults = toolResults;
          break;
        }
      }
    }
  }
  
  if (history.length > 0 && history[history.length - 1].assistantResponseMessage?._pendingToolResults) {
    const toolResults = history[history.length - 1].assistantResponseMessage._pendingToolResults;
    delete history[history.length - 1].assistantResponseMessage._pendingToolResults;
    
    if (currentMessage?.userInputMessage) {
      if (!currentMessage.userInputMessage.userInputMessageContext) {
        currentMessage.userInputMessage.userInputMessageContext = {};
      }
      currentMessage.userInputMessage.userInputMessageContext.toolResults = toolResults;
    }
  }

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
    if (item.assistantResponseMessage?.toolUses) {
      delete item.assistantResponseMessage.toolUses;
    }
    
    if (item.userInputMessage?.userInputMessageContext?.tools) {
      delete item.userInputMessage.userInputMessageContext.tools;
    }
    
    if (item.userInputMessage?.userInputMessageContext?.toolResults) {
      delete item.userInputMessage.userInputMessageContext.toolResults;
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
  history = mergedHistory;

  return { history, currentMessage, systemPrompt };
}

/**
 * Build Kiro payload from OpenAI format
 */
function buildKiroPayload(model, body, stream, credentials) {
  const messages = body.messages || [];
  const tools = body.tools || [];
  const maxTokens = body.max_tokens || 32000;
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

  return payload;
}

register(FORMATS.OPENAI, FORMATS.KIRO, buildKiroPayload, null);

export { buildKiroPayload };
