import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { adjustMaxTokens } from "../formats/maxTokens.js";
import { encodeDataUri } from "../concerns/image.js";
import { collapseTextParts } from "../concerns/message.js";
import { ROLE, GEMINI_ROLE, OPENAI_BLOCK } from "../schema/index.js";

// Convert Gemini request to OpenAI format
export function geminiToOpenAIRequest(model, body, stream) {
  const result = {
    model: model,
    messages: [],
    stream: stream
  };

  // Generation config
  if (body.generationConfig) {
    const config = body.generationConfig;
    if (config.maxOutputTokens) {
      const tempBody = { max_tokens: config.maxOutputTokens, tools: body.tools };
      result.max_tokens = adjustMaxTokens(tempBody);
    }
    if (config.temperature !== undefined) {
      result.temperature = config.temperature;
    }
    if (config.topP !== undefined) {
      result.top_p = config.topP;
    }
  }

  // System instruction
  if (body.systemInstruction) {
    const systemText = extractGeminiText(body.systemInstruction);
    if (systemText) {
      result.messages.push({
        role: ROLE.SYSTEM,
        content: systemText
      });
    }
  }

  // Convert contents to messages.
  // convertGeminiContent may return one message or an array (tool results +
  // co-located call/text). Always spread: push(converted) nests the array as
  // one element and the next turn 400s on unpaired tool calls.
  if (body.contents && Array.isArray(body.contents)) {
    for (const content of body.contents) {
      appendConvertedMessages(result.messages, convertGeminiContent(content));
    }
  }

  // Tools
  if (body.tools && Array.isArray(body.tools)) {
    result.tools = [];
    for (const tool of body.tools) {
      if (tool.functionDeclarations) {
        for (const func of tool.functionDeclarations) {
          result.tools.push({
            type: OPENAI_BLOCK.FUNCTION,
            function: {
              name: func.name,
              description: func.description || "",
              parameters: func.parameters || { type: "object", properties: {} }
            }
          });
        }
      }
    }
  }

  return result;
}

function appendConvertedMessages(messages, converted) {
  if (!converted) return;
  messages.push(...(Array.isArray(converted) ? converted : [converted]));
}

// Convert Gemini content to OpenAI message
function convertGeminiContent(content) {
  const role = content.role === GEMINI_ROLE.USER ? ROLE.USER : ROLE.ASSISTANT;
  
  if (!content.parts || !Array.isArray(content.parts)) {
    return null;
  }

  const parts = [];
  const toolResults = [];
  const toolCalls = [];

  for (const part of content.parts) {
    if (part.text !== undefined) {
      parts.push({ type: OPENAI_BLOCK.TEXT, text: part.text });
    }

    if (part.inlineData) {
      parts.push({
        type: OPENAI_BLOCK.IMAGE_URL,
        image_url: {
          url: encodeDataUri(part.inlineData.mimeType, part.inlineData.data)
        }
      });
    }

    if (part.functionCall) {
      // Gemini lacks a native call id; derive a deterministic one from the name so the
      // matching functionResponse maps to the same tool_call_id (providers require pairing).
      toolCalls.push({
        id: part.functionCall.id || `call_${part.functionCall.name}`,
        type: OPENAI_BLOCK.FUNCTION,
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args || {})
        }
      });
    }

    if (part.functionResponse) {
      toolResults.push({
        role: ROLE.TOOL,
        tool_call_id: part.functionResponse.id || `call_${part.functionResponse.name}`,
        content: JSON.stringify(part.functionResponse.response?.result || part.functionResponse.response || {})
      });
    }
  }

  if (toolCalls.length > 0) {
    const result = { role: ROLE.ASSISTANT };
    if (parts.length > 0) {
      result.content = parts.length === 1 ? parts[0].text : parts;
    }
    result.tool_calls = toolCalls;
    return toolResults.length > 0 ? [...toolResults, result] : result;
  }

  if (parts.length > 0) {
    const result = {
      role,
      content: collapseTextParts(parts)
    };
    return toolResults.length > 0 ? [...toolResults, result] : result;
  }

  if (toolResults.length === 1) return toolResults[0];
  if (toolResults.length > 1) return toolResults;
  return null;
}

// Extract text from Gemini content
function extractGeminiText(content) {
  if (typeof content === "string") return content;
  if (content.parts && Array.isArray(content.parts)) {
    return content.parts.map(p => p.text || "").join("");
  }
  return "";
}

// Register
register(FORMATS.GEMINI, FORMATS.OPENAI, geminiToOpenAIRequest, null);
register(FORMATS.GEMINI_CLI, FORMATS.OPENAI, geminiToOpenAIRequest, null);

