/**
 * Claude to Gemini CLI Request Translator
 * Direct translation from Claude/Anthropic format to Gemini CLI format
 * Optimized to avoid double translation through OpenAI format
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { v4 as uuidv4 } from "uuid";
import {
  DEFAULT_SAFETY_SETTINGS,
  tryParseJSON,
  generateRequestId,
  cleanJSONSchemaForAntigravity
} from "../helpers/geminiHelper.js";
import { deriveSessionId } from "../../utils/sessionManager.js";
import { DEFAULT_THINKING_GEMINI_CLI_SIGNATURE } from "../../config/defaultThinkingSignature.js";

// Sanitize function names for Gemini API
function sanitizeGeminiFunctionName(name) {
  if (!name) return "_unknown";
  let sanitized = name.replace(/[^a-zA-Z0-9_.:\\-]/g, "_");
  if (!/^[a-zA-Z_]/.test(sanitized)) {
    sanitized = "_" + sanitized;
  }
  return sanitized.substring(0, 64);
}

/**
 * Convert Claude messages to Gemini contents format
 */
function convertClaudeMessagesToGemini(messages) {
  const contents = [];
  
  for (const msg of messages) {
    const role = msg.role === "assistant" ? "model" : "user";
    const parts = [];
    
    if (typeof msg.content === "string") {
      parts.push({ text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "text") {
          parts.push({ text: block.text });
        } else if (block.type === "image" && block.source?.type === "base64") {
          // Claude image: { type: "image", source: { type: "base64", media_type, data } }
          const mimeType = block.source.media_type || "image/png";
          parts.push({
            inlineData: {
              mimeType: mimeType,
              data: block.source.data
            }
          });
        } else if (block.type === "tool_use") {
          // Claude tool use: { type: "tool_use", id, name, input }
          parts.push({
            functionCall: {
              id: block.id,
              name: sanitizeGeminiFunctionName(block.name),
              args: block.input || {}
            }
          });
        } else if (block.type === "tool_result") {
          // Claude tool result: { type: "tool_result", tool_use_id, content }
          let resultContent = block.content;
          
          if (Array.isArray(resultContent)) {
            resultContent = resultContent
              .map(c => c.type === "text" ? c.text : JSON.stringify(c))
              .join("\\n");
          }
          
          const parsedResult = tryParseJSON(resultContent) || resultContent;
          
          parts.push({
            functionResponse: {
              id: block.tool_use_id,
              name: "unknown",
              response: { result: parsedResult }
            }
          });
        }
      }
    }
    
    if (parts.length > 0) {
      contents.push({ role, parts });
    }
  }
  
  return contents;
}

/**
 * Convert Claude tools to Gemini functionDeclarations
 */
function convertClaudeToolsToGemini(tools) {
  if (!tools || tools.length === 0) return null;
  
  const functionDeclarations = [];
  
  for (const tool of tools) {
    const cleanedSchema = cleanJSONSchemaForAntigravity(tool.input_schema || {});
    
    functionDeclarations.push({
      name: sanitizeGeminiFunctionName(tool.name),
      description: tool.description || "",
      parameters: cleanedSchema
    });
  }
  
  return {
    tools: [{ functionDeclarations }],
    toolConfig: {
      functionCallingConfig: { mode: "VALIDATED" }
    }
  };
}

/**
 * Build Gemini CLI payload from Claude format
 */
export function claudeToGeminiCLIRequest(model, body, stream, credentials) {
  const result = {
    model: model,
    contents: [],
    generationConfig: {},
    safetySettings: DEFAULT_SAFETY_SETTINGS
  };
  
  // Generation config
  if (body.temperature !== undefined) {
    result.generationConfig.temperature = body.temperature;
  }
  if (body.top_p !== undefined) {
    result.generationConfig.topP = body.top_p;
  }
  if (body.top_k !== undefined) {
    result.generationConfig.topK = body.top_k;
  }
  if (body.max_tokens !== undefined) {
    result.generationConfig.maxOutputTokens = body.max_tokens;
  }
  
  // System instruction
  if (body.system) {
    let systemText = "";
    if (typeof body.system === "string") {
      systemText = body.system;
    } else if (Array.isArray(body.system)) {
      systemText = body.system.map(s => s.text || "").join("\\n");
    }
    
    if (systemText) {
      result.systemInstruction = {
        role: "user",
        parts: [{ text: systemText }]
      };
    }
  }
  
  // Convert messages
  if (body.messages && Array.isArray(body.messages)) {
    result.contents = convertClaudeMessagesToGemini(body.messages);
  }
  
  // Convert tools
  if (body.tools && Array.isArray(body.tools)) {
    const toolsConfig = convertClaudeToolsToGemini(body.tools);
    if (toolsConfig) {
      result.tools = toolsConfig.tools;
      result.toolConfig = toolsConfig.toolConfig;
    }
  }
  
  return result;
}

/**
 * Wrap Gemini CLI request in Cloud Code envelope
 */
function wrapInCloudCodeEnvelope(model, geminiRequest, credentials) {
  const projectId = credentials?.projectId || `project-${uuidv4()}`;
  const sessionId = deriveSessionId(credentials?.email || credentials?.connectionId);
  
  const envelope = {
    project: projectId,
    model: model,
    userAgent: "gemini-cli",
    requestId: `agent-${uuidv4()}`,
    requestType: "agent",
    request: {
      sessionId: sessionId,
      contents: geminiRequest.contents || [],
      generationConfig: geminiRequest.generationConfig || {},
      safetySettings: geminiRequest.safetySettings || DEFAULT_SAFETY_SETTINGS
    }
  };
  
  // Add system instruction
  if (geminiRequest.systemInstruction) {
    envelope.request.systemInstruction = geminiRequest.systemInstruction;
  }
  
  // Add tools
  if (geminiRequest.tools) {
    envelope.request.tools = geminiRequest.tools;
  }
  
  if (geminiRequest.toolConfig) {
    envelope.request.toolConfig = geminiRequest.toolConfig;
  }
  
  return envelope;
}

/**
 * Main translator function with Cloud Code envelope
 */
export function claudeToGeminiCLIWithEnvelope(model, body, stream, credentials) {
  const geminiRequest = claudeToGeminiCLIRequest(model, body, stream, credentials);
  return wrapInCloudCodeEnvelope(model, geminiRequest, credentials);
}

// Register translator
register(FORMATS.CLAUDE, FORMATS.GEMINI_CLI, claudeToGeminiCLIWithEnvelope, null);
