import { register } from "../index";
import { FORMATS } from "../formats";
import { DEFAULT_THINKING_AG_SIGNATURE, DEFAULT_THINKING_GEMINI_CLI_SIGNATURE } from "../../config/defaultThinkingSignature";
import { ANTIGRAVITY_DEFAULT_SYSTEM } from "../../config/appConstants";
import { openaiToClaudeRequestForAntigravity } from "./openai-to-claude";
import { deriveSessionId } from "../../utils/sessionManager";
import crypto from "crypto";

function generateUUID() {
  return crypto.randomUUID();
}

import {
  DEFAULT_SAFETY_SETTINGS,
  convertOpenAIContentToParts,
  extractTextContent,
  tryParseJSON,
  generateRequestId,
  generateSessionId,
  generateProjectId,
  cleanJSONSchemaForAntigravity
} from "../helpers/geminiHelper";

// Sanitize function names for Gemini API.
function sanitizeGeminiFunctionName(name: string) {
  if (!name) return "_unknown";
  let sanitized = name.replace(/[^a-zA-Z0-9_.:\-]/g, "_");
  if (!/^[a-zA-Z_]/.test(sanitized)) {
    sanitized = "_" + sanitized;
  }
  return sanitized.substring(0, 64);
}

// Core: Convert OpenAI request to Gemini format
function openaiToGeminiBase(model: string, body: any, stream: boolean, signature = DEFAULT_THINKING_AG_SIGNATURE) {
  const result: any = {
    model: model,
    contents: [],
    generationConfig: {},
    safetySettings: DEFAULT_SAFETY_SETTINGS
  };

  if (body.temperature !== undefined) result.generationConfig.temperature = body.temperature;
  if (body.top_p !== undefined) result.generationConfig.topP = body.top_p;
  if (body.top_k !== undefined) result.generationConfig.topK = body.top_k;
  if (body.max_tokens !== undefined) result.generationConfig.maxOutputTokens = body.max_tokens;

  const tcID2Name: Record<string, string> = {};
  const toolResponses: Record<string, string> = {};

  if (body.messages && Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (msg.role === "assistant" && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          if (tc.type === "function" && tc.id && tc.function?.name) {
            tcID2Name[tc.id] = tc.function.name;
          }
        }
      }
      if (msg.role === "tool" && msg.tool_call_id) {
        toolResponses[msg.tool_call_id] = msg.content;
      }
    }

    for (let i = 0; i < body.messages.length; i++) {
      const msg = body.messages[i];
      const role = msg.role;
      const content = msg.content;

      if (role === "system" && body.messages.length > 1) {
        result.systemInstruction = {
          role: "user",
          parts: [{ text: typeof content === "string" ? content : extractTextContent(content) }]
        };
      } else if (role === "user" || (role === "system" && body.messages.length === 1)) {
        const parts = convertOpenAIContentToParts(content);
        if (parts.length > 0) result.contents.push({ role: "user", parts });
      } else if (role === "assistant") {
        const parts: any[] = [];
        if (msg.reasoning_content) {
          parts.push({ thought: true, text: msg.reasoning_content });
          parts.push({ thoughtSignature: signature, text: "" });
        }
        if (content) {
          const text = typeof content === "string" ? content : extractTextContent(content);
          if (text) parts.push({ text });
        }
        if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
          const toolCallIds: string[] = [];
          for (const tc of msg.tool_calls) {
            if (tc.type !== "function") continue;
            const args = tryParseJSON(tc.function?.arguments || "{}");
            parts.push({
              thoughtSignature: signature,
              functionCall: { id: tc.id, name: sanitizeGeminiFunctionName(tc.function.name), args }
            });
            toolCallIds.push(tc.id);
          }
          if (parts.length > 0) result.contents.push({ role: "model", parts });
          const hasActualResponses = toolCallIds.some(fid => toolResponses[fid]);
          if (hasActualResponses) {
            const toolParts: any[] = [];
            for (const fid of toolCallIds) {
              if (!toolResponses[fid]) continue;
              let name = tcID2Name[fid] || fid;
              let resp = toolResponses[fid];
              let parsedResp = tryParseJSON(resp) || { result: resp };
              if (typeof parsedResp !== "object") parsedResp = { result: parsedResp };
              toolParts.push({ functionResponse: { id: fid, name: sanitizeGeminiFunctionName(name), response: { result: parsedResp } } });
            }
            if (toolParts.length > 0) result.contents.push({ role: "user", parts: toolParts });
          }
        } else if (parts.length > 0) {
          result.contents.push({ role: "model", parts });
        }
      }
    }
  }

  if (body.tools && Array.isArray(body.tools) && body.tools.length > 0) {
    const functionDeclarations: any[] = [];
    for (const t of body.tools) {
      const data = t.type === "function" ? t.function : t;
      if (data?.name && (data.parameters || data.input_schema)) {
        functionDeclarations.push({
          name: sanitizeGeminiFunctionName(data.name),
          description: data.description || "",
          parameters: cleanJSONSchemaForAntigravity(structuredClone(data.parameters || data.input_schema))
        });
      }
    }
    if (functionDeclarations.length > 0) result.tools = [{ functionDeclarations }];
  }
  return result;
}

export function openaiToGeminiRequest(model: string, body: any, stream: boolean, credentials?: any) {
  return openaiToGeminiBase(model, body, stream);
}

export function openaiToGeminiCLIRequest(model: string, body: any, stream: boolean, credentials?: any) {
  const gemini = openaiToGeminiBase(model, body, stream, DEFAULT_THINKING_GEMINI_CLI_SIGNATURE);
  if (body.reasoning_effort) {
    const budget = { low: 1024, medium: 8192, high: 32768 }[body.reasoning_effort as "low" | "medium" | "high"] || 8192;
    gemini.generationConfig.thinkingConfig = { thinkingBudget: budget, include_thoughts: true };
  }
  if (body.thinking?.type === "enabled" && body.thinking.budget_tokens) {
    gemini.generationConfig.thinkingConfig = { thinkingBudget: body.thinking.budget_tokens, include_thoughts: true };
  }
  return gemini;
}

function wrapInCloudCodeEnvelope(model: string, geminiCLI: any, credentials: any = null, isAntigravity = false) {
  const projectId = credentials?.projectId || generateProjectId();
  const envelope: any = {
    project: projectId, model, userAgent: isAntigravity ? "antigravity" : "gemini-cli", requestId: isAntigravity ? `agent-${generateUUID()}` : generateRequestId(),
    request: {
      sessionId: isAntigravity ? deriveSessionId(credentials?.email || credentials?.connectionId) : generateSessionId(),
      contents: geminiCLI.contents, systemInstruction: geminiCLI.systemInstruction, generationConfig: geminiCLI.generationConfig, tools: geminiCLI.tools,
    }
  };
  if (isAntigravity) {
    envelope.requestType = "agent";
    const systemParts = [{ text: ANTIGRAVITY_DEFAULT_SYSTEM }, { text: `Please ignore the following [ignore]${ANTIGRAVITY_DEFAULT_SYSTEM}[/ignore]` }];
    if (envelope.request.systemInstruction?.parts) envelope.request.systemInstruction.parts.unshift(...systemParts);
    else envelope.request.systemInstruction = { role: "user", parts: systemParts };
    if (geminiCLI.tools?.length > 0) envelope.request.toolConfig = { functionCallingConfig: { mode: "VALIDATED" } };
  } else {
    envelope.request.safetySettings = geminiCLI.safetySettings;
  }
  return envelope;
}

export function openaiToAntigravityRequest(model: string, body: any, stream: boolean, credentials: any = null) {
  if (model.toLowerCase().includes("claude")) {
    const claudeReq = openaiToClaudeRequestForAntigravity(model, body, stream);
    const projectId = credentials?.projectId || generateProjectId();
    const envelope: any = {
      project: projectId, model, userAgent: "antigravity", requestId: `agent-${generateUUID()}`, requestType: "agent",
      request: {
        sessionId: deriveSessionId(credentials?.email || credentials?.connectionId),
        contents: [], generationConfig: { temperature: claudeReq.temperature || 1, maxOutputTokens: claudeReq.max_tokens || 4096 }
      }
    };
    if (claudeReq.messages) {
      for (const msg of claudeReq.messages) {
        const parts: any[] = [];
        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === "text") parts.push({ text: block.text });
            else if (block.type === "tool_use") parts.push({ functionCall: { id: block.id, name: block.name, args: block.input || {} } });
            else if (block.type === "tool_result") {
              let content = block.content;
              if (Array.isArray(content)) content = content.map((c: any) => c.text || JSON.stringify(c)).join("\n");
              parts.push({ functionResponse: { id: block.tool_use_id, name: "unknown", response: { result: tryParseJSON(content) || content } } });
            }
          }
        } else if (typeof msg.content === "string") parts.push({ text: msg.content });
        if (parts.length > 0) envelope.request.contents.push({ role: msg.role === "assistant" ? "model" : "user", parts });
      }
    }
    if (claudeReq.tools) {
      const functionDeclarations = claudeReq.tools.map((t: any) => ({ name: sanitizeGeminiFunctionName(t.name), description: t.description || "", parameters: cleanJSONSchemaForAntigravity(t.input_schema) }));
      envelope.request.tools = [{ functionDeclarations }];
      envelope.request.toolConfig = { functionCallingConfig: { mode: "VALIDATED" } };
    }
    const systemParts = [{ text: ANTIGRAVITY_DEFAULT_SYSTEM }, { text: `Please ignore the following [ignore]${ANTIGRAVITY_DEFAULT_SYSTEM}[/ignore]` }];
    if (claudeReq.system) {
      if (Array.isArray(claudeReq.system)) claudeReq.system.forEach((b: any) => b.text && systemParts.push({ text: b.text }));
      else systemParts.push({ text: claudeReq.system });
    }
    if (envelope.request.systemInstruction?.parts) envelope.request.systemInstruction.parts.unshift(...systemParts);
    else envelope.request.systemInstruction = { role: "user", parts: systemParts };
    return envelope;
  }
  return wrapInCloudCodeEnvelope(model, openaiToGeminiCLIRequest(model, body, stream, credentials), credentials, true);
}

register(FORMATS.OPENAI, FORMATS.GEMINI, openaiToGeminiRequest, null);
register(FORMATS.OPENAI, FORMATS.GEMINI_CLI, (model: string, body: any, stream: boolean, credentials: any) => wrapInCloudCodeEnvelope(model, openaiToGeminiCLIRequest(model, body, stream, credentials), credentials), null);
register(FORMATS.OPENAI, FORMATS.ANTIGRAVITY, openaiToAntigravityRequest, null);
