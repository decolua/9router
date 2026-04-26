/**
 * OpenAI to Kiro Request Translator
 * Converts OpenAI Chat Completions format to Kiro/AWS CodeWhisperer format
 */
import { register } from "../index";
import { FORMATS } from "../formats";
import { v4 as uuidv4 } from "uuid";

/**
 * Convert OpenAI messages to Kiro format
 * Rules: system/tool/user -> user role, merge consecutive same roles
 */
function convertMessages(messages: any[], tools: any[], model: string) {
  const history: any[] = [];
  let currentMessage: any = null;
  
  let pendingUserContent: string[] = [];
  let pendingAssistantContent: string[] = [];
  const pendingToolResults: any[] = [];
  const pendingImages: any[] = [];
  let currentRole: string | null = null;

  // Image support is pre-filtered by caps in translateRequest before reaching here
  const supportsImages = true;

  const flushPending = () => {
    if (currentRole === "user") {
      const content = pendingUserContent.join("\n\n").trim() || "continue";
      const userMsg: any = {
        userInputMessage: {
          content: content,
          modelId: ""
        }
      };

      if (pendingImages.length > 0) {
        userMsg.userInputMessage.images = [...pendingImages];
      }

      if (pendingToolResults.length > 0) {
        userMsg.userInputMessage.userInputMessageContext = {
          toolResults: [...pendingToolResults]
        };
      }

      if (pendingToolResults.length > 0) {
        if (!userMsg.userInputMessage.userInputMessageContext) {
          userMsg.userInputMessage.userInputMessageContext = {};
        }
        userMsg.userInputMessage.userInputMessageContext.toolResults = [...pendingToolResults];
      }
      
      if (tools && tools.length > 0 && history.length === 0) {
        if (!userMsg.userInputMessage.userInputMessageContext) {
          userMsg.userInputMessage.userInputMessageContext = {};
        }
        userMsg.userInputMessage.userInputMessageContext.tools = tools.map((t: any) => {
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
      }
      
      history.push(userMsg);
      currentMessage = userMsg;
      pendingUserContent = [];
      pendingImages.length = 0;
      pendingToolResults.length = 0;
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
    
    if (role === "system" || role === "tool") {
      role = "user";
    }
    
    if (role !== currentRole && currentRole !== null) {
      flushPending();
    }
    currentRole = role;
    
    if (role === "user") {
      let content = "";
      if (typeof msg.content === "string") {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        const textParts: string[] = [];
        for (const c of msg.content) {
          if (c.type === "text" || c.text) {
            textParts.push(c.text || "");
          } else if (supportsImages && c.type === "image_url") {
            const url = c.image_url?.url || "";
            const base64Match = url.match(/^data:([^;]+);base64,(.+)$/);
            if (base64Match) {
              const mediaType = base64Match[1];
              const format = mediaType.split("/")[1] || mediaType;
              pendingImages.push({ format, source: { bytes: base64Match[2] } });
            } else if (url.startsWith("http://") || url.startsWith("https://")) {
              const normalizedUrl = url.split("?")[0].split("#")[0];
              const lastSegment = normalizedUrl.split("/").pop() || "";
              const extension = lastSegment.includes(".") ? lastSegment.split(".").pop() : "";
              const format = extension || "png";
              pendingImages.push({ format, source: { url } });
            }
          } else if (supportsImages && c.type === "image") {
            if (c.source?.type === "base64" && c.source?.data) {
              const mediaType = c.source.media_type || "image/png";
              const format = mediaType.split("/")[1] || mediaType;
              pendingImages.push({ format, source: { bytes: c.source.data } });
            }
          }
        }
        content = textParts.join("\n");
        
        const toolResultBlocks = msg.content.filter((c: any) => c.type === "tool_result");
        if (toolResultBlocks.length > 0) {
          toolResultBlocks.forEach((block: any) => {
            const text = Array.isArray(block.content) 
              ? block.content.map((c: any) => c.text || "").join("\n")
              : (typeof block.content === "string" ? block.content : "");
            
            pendingToolResults.push({
              toolUseId: block.tool_use_id,
              status: "success",
              content: [{ text: text }]
            });
          });
        }
      }
      
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
      let textContent = "";
      let toolUses: any[] = [];
      
      if (Array.isArray(msg.content)) {
        const textBlocks = msg.content.filter((c: any) => c.type === "text");
        textContent = textBlocks.map((b: any) => b.text).join("\n").trim();
        
        const toolUseBlocks = msg.content.filter((c: any) => c.type === "tool_use");
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
      
      if (toolUses.length > 0) {
        flushPending();
        
        const lastMsg: any = history[history.length - 1];
        if (lastMsg?.assistantResponseMessage) {
          lastMsg.assistantResponseMessage.toolUses = toolUses.map((tc: any) => {
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
  
  if (currentRole !== null) {
    flushPending();
  }
  
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].userInputMessage) {
      currentMessage = history.splice(i, 1)[0];
      break;
    }
  }

  const firstHistoryTools = history[0]?.userInputMessage?.userInputMessageContext?.tools;

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

  const mergedHistory: any[] = [];
  for (let i = 0; i < history.length; i++) {
    const current = history[i];
    if (current.userInputMessage &&
        mergedHistory.length > 0 &&
        mergedHistory[mergedHistory.length - 1].userInputMessage) {
      const prev = mergedHistory[mergedHistory.length - 1];
      prev.userInputMessage.content += "\n\n" + current.userInputMessage.content;

      const prevContext = prev.userInputMessage.userInputMessageContext || {};
      const currentContext = current.userInputMessage.userInputMessageContext || {};
      const mergedContext: Record<string, any> = { ...prevContext, ...currentContext };

      const prevImages = prev.userInputMessage.images || prevContext.images || [];
      const currentImages = current.userInputMessage.images || currentContext.images || [];
      const allImages = [...prevImages, ...currentImages];
      if (allImages.length > 0) {
        prev.userInputMessage.images = allImages;
      }
      delete mergedContext.images;

      const prevToolResults = prevContext.toolResults || [];
      const currentToolResults = currentContext.toolResults || [];
      const allToolResults = [...prevToolResults, ...currentToolResults];
      if (allToolResults.length > 0) {
        mergedContext.toolResults = allToolResults;
      }

      if (Object.keys(mergedContext).length > 0) {
        prev.userInputMessage.userInputMessageContext = mergedContext;
      }
    } else {
      mergedHistory.push(current);
    }
  }

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
 * Build Kiro payload from OpenAI format
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function buildKiroPayload(model: string, body: any, _stream: boolean, credentials?: any) {
  const messages = body.messages || [];
  const tools = body.tools || [];
  const temperature = body.temperature;
  const topP = body.top_p;

  const { history, currentMessage } = convertMessages(messages, tools, model);

  const profileArn = credentials?.providerSpecificData?.profileArn || "";

  let finalContent = currentMessage?.userInputMessage?.content || "";
  const timestamp = new Date().toISOString();
  finalContent = `[Context: Current time is ${timestamp}]\n\n${finalContent}`;
  
  const payload: any = {
    conversationState: {
      chatTriggerType: "MANUAL",
      conversationId: uuidv4(),
      currentMessage: {
        userInputMessage: {
          content: finalContent,
          modelId: model,
          origin: "AI_EDITOR",
          ...(currentMessage?.userInputMessage?.images && {
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

  if (temperature !== undefined || topP !== undefined) {
    payload.inferenceConfig = {};
    if (temperature !== undefined) payload.inferenceConfig.temperature = temperature;
    if (topP !== undefined) payload.inferenceConfig.topP = topP;
  }

  return payload;
}

register(FORMATS.OPENAI, FORMATS.KIRO, buildKiroPayload, null);
