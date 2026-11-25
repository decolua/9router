import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { adjustMaxTokens } from "../formats/maxTokens.js";
import { encodeDataUri } from "../concerns/image.js";
import { collapseTextParts } from "../concerns/message.js";
import { functionResponseToToolContent } from "../formats/gemini.js";
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

  // Convert contents to messages
  if (body.contents && Array.isArray(body.contents)) {
    const idlessIds = { calls: new Map(), responses: new Map() };
    for (const content of body.contents) {
      const converted = convertGeminiContent(content, idlessIds);
      if (converted) {
        if (Array.isArray(converted)) result.messages.push(...converted);
        else result.messages.push(converted);
      }
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

// Gemini may omit call ids. Derive one from the name (`call_<name>`) and number
// repeat occurrences, so the Nth call of a tool pairs with its Nth response even
// when the same tool is called in parallel (providers require tool_call_id pairing).
function nextIdlessId(counters, name) {
  const n = counters.get(name) || 0;
  counters.set(name, n + 1);
  return n === 0 ? `call_${name}` : `call_${name}_${n + 1}`;
}

// Convert Gemini content to OpenAI message
function convertGeminiContent(content, idlessIds) {
  const role = content.role === GEMINI_ROLE.USER ? ROLE.USER : ROLE.ASSISTANT;
  
  if (!content.parts || !Array.isArray(content.parts)) {
    return null;
  }

  const parts = [];
  const toolCalls = [];
  const toolResults = [];

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
      toolCalls.push({
        id: part.functionCall.id || nextIdlessId(idlessIds.calls, part.functionCall.name),
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
        tool_call_id: part.functionResponse.id || nextIdlessId(idlessIds.responses, part.functionResponse.name),
        content: functionResponseToToolContent(part.functionResponse.response)
      });
    }
  }

  let message = null;
  if (toolCalls.length > 0) {
    message = { role: ROLE.ASSISTANT };
    if (parts.length > 0) {
      message.content = parts.length === 1 ? parts[0].text : parts;
    }
    message.tool_calls = toolCalls;
  } else if (parts.length > 0) {
    message = {
      role,
      content: collapseTextParts(parts)
    };
  }

  // Complete the parts scan before returning: parallel results must all precede
  // any co-located follow-up text or calls in the OpenAI message sequence.
  if (toolResults.length > 0) {
    return message ? [...toolResults, message] : toolResults;
  }
  return message;
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

