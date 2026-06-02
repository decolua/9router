/**
 * Kiro to OpenAI Request Translator
 * Converts Kiro/AWS CodeWhisperer format to OpenAI Chat Completions format
 *
 * Reverse of openai-to-kiro.js
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";

const TS_PREFIX_RE = /^\[Context: Current time is .+?\]\n\n/;

/**
 * Convert Kiro toolSpecification to OpenAI function tool format
 */
function convertToolSpec(ts) {
  const schema = ts.inputSchema?.json || {};
  return {
    type: "function",
    function: {
      name: ts.name,
      description: ts.description || "",
      parameters: Object.keys(schema).length === 0
        ? { type: "object", properties: {}, required: [] }
        : schema
    }
  };
}

/**
 * Convert Kiro toolUse to OpenAI tool_call format
 */
function convertToolUse(tu) {
  return {
    id: tu.toolUseId,
    type: "function",
    function: {
      name: tu.name,
      arguments: typeof tu.input === "string" ? tu.input : JSON.stringify(tu.input)
    }
  };
}

/**
 * Strip [Context: Current time is ...] prefix injected by openai-to-kiro
 */
function stripTimestamp(content) {
  if (typeof content !== "string") return content;
  return content.replace(TS_PREFIX_RE, "");
}

/**
 * Convert Kiro images array to OpenAI content parts
 * Returns null if no images, or array of image_url content parts
 */
function convertImages(images) {
  if (!images || !Array.isArray(images) || images.length === 0) return null;
  return images.map(img => ({
    type: "image_url",
    image_url: {
      url: `data:image/${img.format};base64,${img.source.bytes}`
    }
  }));
}

/**
 * Process a userInputMessage and push messages (tool results + user message)
 */
function processUserMessage(uim, messages) {
  const ctx = uim.userInputMessageContext;

  // Tool results become separate tool-role messages BEFORE the user message
  if (ctx?.toolResults && Array.isArray(ctx.toolResults)) {
    for (const tr of ctx.toolResults) {
      const text = tr.content
        ?.map(c => c.text || "")
        .join("\n") || "";
      messages.push({
        role: "tool",
        tool_call_id: tr.toolUseId,
        content: text
      });
    }
  }

  // Build content: string or array of content parts
  const rawContent = uim.content || "";
  const stripped = stripTimestamp(rawContent);
  const images = convertImages(uim.images);

  if (images && images.length > 0) {
    const parts = [...images];
    if (stripped) parts.push({ type: "text", text: stripped });
    messages.push({ role: "user", content: parts });
  } else if (stripped) {
    messages.push({ role: "user", content: stripped });
  }
  // If content is empty and no images, skip — don't push empty message
}

/**
 * Process an assistantResponseMessage and push to messages array
 */
function processAssistantMessage(arm, messages) {
  const msg = {
    role: "assistant",
    content: arm.content || ""
  };

  if (arm.toolUses && Array.isArray(arm.toolUses) && arm.toolUses.length > 0) {
    msg.tool_calls = arm.toolUses.map(convertToolUse);
  }

  messages.push(msg);
}

/**
 * Build OpenAI Chat Completions payload from Kiro conversationState format
 */
export function buildOpenAIPayload(model, body, stream, credentials) {
  const cs = body.conversationState || {};
  const history = cs.history || [];
  const currentMessage = cs.currentMessage;
  const inferenceConfig = body.inferenceConfig || {};

  const messages = [];
  let tools = [];

  // Process history items (alternating userInputMessage / assistantResponseMessage)
  for (const item of history) {
    if (item.userInputMessage) {
      processUserMessage(item.userInputMessage, messages);
    } else if (item.assistantResponseMessage) {
      processAssistantMessage(item.assistantResponseMessage, messages);
    }
  }

  // Process currentMessage (the last user message, popped from history in original)
  if (currentMessage?.userInputMessage) {
    const uim = currentMessage.userInputMessage;
    const ctx = uim.userInputMessageContext;

    // Extract tools from currentMessage context (moved there by openai-to-kiro)
    if (ctx?.tools && Array.isArray(ctx.tools)) {
      tools = ctx.tools.map(t => convertToolSpec(t.toolSpecification));
    }

    processUserMessage(uim, messages);
  }

  // Assemble OpenAI body
  const effectiveModel = model || currentMessage?.userInputMessage?.modelId || "";
  const openaiBody = {
    model: effectiveModel,
    messages,
    stream: stream !== undefined ? stream : true
  };

  if (tools.length > 0) openaiBody.tools = tools;
  if (inferenceConfig.maxTokens) openaiBody.max_tokens = inferenceConfig.maxTokens;
  if (inferenceConfig.temperature !== undefined) openaiBody.temperature = inferenceConfig.temperature;
  if (inferenceConfig.topP !== undefined) openaiBody.top_p = inferenceConfig.topP;

  return openaiBody;
}

register(FORMATS.KIRO, FORMATS.OPENAI, buildOpenAIPayload, null);