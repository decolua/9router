import crypto from "crypto";

export function compressToolNames(sourceFormat, body) {
  const isClaude = sourceFormat === "claude";
  const isOpenAI = sourceFormat === "openai";
  
  if (!isClaude && !isOpenAI) return { body, toolNameMap: null };

  const tools = body.tools;
  if (!tools || !Array.isArray(tools) || tools.length === 0) return { body, toolNameMap: null };

  const toolNameMap = new Map();
  let changed = false;

  const getToolName = (t) => isClaude ? t.name : t.function?.name;
  const setToolName = (t, name) => isClaude ? { ...t, name } : { ...t, function: { ...t.function, name } };

  const compressName = (name) => {
    if (!name || name.length <= 64) return name;
    const hash = crypto.createHash("md5").update(name).digest("hex").substring(0, 8);
    const shortName = name.substring(0, 55) + "_" + hash;
    return shortName;
  };

  const newTools = tools.map(tool => {
    const originalName = getToolName(tool);
    if (!originalName) return tool;
    const shortName = compressName(originalName);
    if (shortName !== originalName) {
      toolNameMap.set(shortName, originalName);
      changed = true;
      return setToolName(tool, shortName);
    }
    return tool;
  });

  if (!changed) return { body, toolNameMap: null };

  const newMessages = body.messages?.map(msg => {
    if (isClaude) {
      if (!Array.isArray(msg.content)) return msg;
      const newContent = msg.content.map(block => {
        if (block.type === "tool_use" && toolNameMap.has(block.name)) {
          return { ...block, name: toolNameMap.get(block.name) };
        }
        return block;
      });
      return { ...msg, content: newContent };
    } else if (isOpenAI) {
      if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
        const newToolCalls = msg.tool_calls.map(tc => {
          if (tc.type === "function" && tc.function && toolNameMap.has(tc.function.name)) {
            return { ...tc, function: { ...tc.function, name: toolNameMap.get(tc.function.name) } };
          }
          return tc;
        });
        return { ...msg, tool_calls: newToolCalls };
      }
      return msg;
    }
    return msg;
  });

  let newToolChoice = body.tool_choice;
  if (isClaude && body.tool_choice?.type === "tool" && toolNameMap.has(body.tool_choice.name)) {
    newToolChoice = { ...body.tool_choice, name: toolNameMap.get(body.tool_choice.name) };
  } else if (isOpenAI && body.tool_choice?.type === "function" && toolNameMap.has(body.tool_choice.function?.name)) {
    newToolChoice = { ...body.tool_choice, function: { ...body.tool_choice.function, name: toolNameMap.get(body.tool_choice.function.name) } };
  }

  const newBody = { ...body, tools: newTools };
  if (newMessages) newBody.messages = newMessages;
  if (newToolChoice) newBody.tool_choice = newToolChoice;

  return { body: newBody, toolNameMap };
}

export function decloakOpenAIChunk(chunk, toolNameMap) {
  if (!toolNameMap?.size || !chunk || !chunk.choices) return chunk;
  
  let changed = false;
  const newChoices = chunk.choices.map(choice => {
    if (choice.delta?.tool_calls) {
      const newToolCalls = choice.delta.tool_calls.map(tc => {
        if (tc.function?.name && toolNameMap.has(tc.function.name)) {
          changed = true;
          return { ...tc, function: { ...tc.function, name: toolNameMap.get(tc.function.name) } };
        }
        return tc;
      });
      return { ...choice, delta: { ...choice.delta, tool_calls: newToolCalls } };
    } else if (choice.message?.tool_calls) {
      const newToolCalls = choice.message.tool_calls.map(tc => {
        if (tc.function?.name && toolNameMap.has(tc.function.name)) {
          changed = true;
          return { ...tc, function: { ...tc.function, name: toolNameMap.get(tc.function.name) } };
        }
        return tc;
      });
      return { ...choice, message: { ...choice.message, tool_calls: newToolCalls } };
    }
    return choice;
  });

  if (!changed) return chunk;
  return { ...chunk, choices: newChoices };
}
