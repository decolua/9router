/**
 * OpenAI → CommandCode request translator
 *
 * Upstream `/alpha/generate` schema (verified live with curl 2026-05-07):
 *  - params.system: STRING at top level (Anthropic-style; system messages NOT allowed in messages[])
 *  - params.messages[*].role ∈ {"user","assistant","tool"}
 *  - params.messages[*].content: Array of content blocks (NEVER a string)
 *  - image_url / image source → {type:"image", image:"data:...;base64,...", mimeType}
 *  - tool_use blocks (assistant): {type:"tool-call", toolCallId, toolName, input}
 *  - tool_result blocks (role=user): {type:"tool-result", toolCallId, toolName, output}
 *  - tools[*]: Anthropic plain {name, description, input_schema}
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { ROLE, OPENAI_BLOCK, CLAUDE_BLOCK } from "../schema/index.js";
import { DEFAULT_MAX_TOKENS } from "../../config/runtimeConfig.js";
import { parseDataUri, encodeDataUri } from "../concerns/image.js";

function flattenText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = [];
    for (const p of content) {
      if (typeof p === "string") parts.push(p);
      else if (p && typeof p === "object" && typeof p.text === "string") parts.push(p.text);
    }
    return parts.join("\n");
  }
  return String(content);
}

function toNativeImageBlock(part) {
  if (!part || typeof part !== "object") return null;

  if (part.type === OPENAI_BLOCK.IMAGE_URL) {
    const url = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
    const parsed = parseDataUri(url);
    if (!parsed) return null;
    return {
      type: OPENAI_BLOCK.IMAGE,
      image: encodeDataUri(parsed.mimeType, parsed.base64),
      mimeType: parsed.mimeType,
    };
  }

  if (part.type === OPENAI_BLOCK.IMAGE || part.type === CLAUDE_BLOCK.IMAGE) {
    if (typeof part.image === "string" && part.image.startsWith("data:")) {
      const parsed = parseDataUri(part.image);
      const mime = part.mimeType || parsed?.mimeType || "image/png";
      return {
        type: OPENAI_BLOCK.IMAGE,
        image: part.image,
        mimeType: mime,
      };
    }
    const source = part.source;
    if (source?.type === "base64" && typeof source.data === "string") {
      const mime = source.media_type || "image/png";
      return {
        type: OPENAI_BLOCK.IMAGE,
        image: encodeDataUri(mime, source.data),
        mimeType: mime,
      };
    }
  }

  return null;
}

function toContentBlocks(content) {
  if (content == null) return [{ type: OPENAI_BLOCK.TEXT, text: "" }];
  if (typeof content === "string") return [{ type: OPENAI_BLOCK.TEXT, text: content }];
  if (Array.isArray(content)) {
    const blocks = [];
    for (const part of content) {
      if (typeof part === "string") {
        blocks.push({ type: OPENAI_BLOCK.TEXT, text: part });
      } else if (part && typeof part === "object") {
        if (part.type === OPENAI_BLOCK.TEXT && typeof part.text === "string") {
          blocks.push({ type: OPENAI_BLOCK.TEXT, text: part.text });
        } else {
          const image = toNativeImageBlock(part);
          if (image) blocks.push(image);
          else if (typeof part.text === "string") {
            blocks.push({ type: OPENAI_BLOCK.TEXT, text: part.text });
          }
        }
      }
    }
    return blocks.length ? blocks : [{ type: OPENAI_BLOCK.TEXT, text: "" }];
  }
  return [{ type: OPENAI_BLOCK.TEXT, text: String(content) }];
}

function parseToolInput(value, callId) {
  if (value == null || value === "") return {};

  let input = value;
  if (typeof value === "string") {
    try {
      input = JSON.parse(value);
    } catch (error) {
      throw new Error(`assistant tool call ${callId || "<unknown>"} has invalid arguments: ${error.message}`);
    }
  }

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`assistant tool call ${callId || "<unknown>"} arguments must be a JSON object`);
  }
  return input;
}

function convertMessages(messages = []) {
  const out = [];
  const systemTexts = [];
  const toolNames = new Map();

  for (const m of messages) {
    if (!m) continue;
    const role = m.role;

    if (role === ROLE.SYSTEM || role === ROLE.DEVELOPER) {
      const t = flattenText(m.content);
      if (t) systemTexts.push(t);
      continue;
    }

    if (role === ROLE.TOOL) {
      const toolCallId = m.tool_call_id || "";
      const toolName = m.name || toolNames.get(toolCallId) || "";
      if (!toolCallId) throw new Error("tool message requires tool_call_id");
      if (!toolName) throw new Error(`cannot resolve tool name for tool_call_id ${toolCallId}`);
      const value = typeof m.content === "string" ? m.content : flattenText(m.content);
      out.push({
        role: ROLE.TOOL,
        content: [{
          type: "tool-result",
          toolCallId,
          toolName,
          output: { type: "text", value },
        }],
      });
      continue;
    }

    if (role === ROLE.ASSISTANT) {
      const blocks = [];
      const rc = m.reasoning_content || m.thought || m.reasoning;
      if (rc) blocks.push({ type: "reasoning", text: rc });
      const text = flattenText(m.content);
      if (text) blocks.push({ type: OPENAI_BLOCK.TEXT, text });
      if (Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          const fn = tc.function || {};
          const id = tc.id || "";
          if (!id) throw new Error("assistant tool call requires a non-empty id");
          if (!fn.name) throw new Error(`assistant tool call ${id} requires a non-empty function name`);
          toolNames.set(id, fn.name);
          blocks.push({
            type: "tool-call",
            toolCallId: id,
            toolName: fn.name,
            input: parseToolInput(fn.arguments, id),
          });
        }
      }
      out.push({ role: ROLE.ASSISTANT, content: blocks.length ? blocks : [{ type: OPENAI_BLOCK.TEXT, text: "" }] });
      continue;
    }

    out.push({ role: ROLE.USER, content: toContentBlocks(m.content) });
  }

  return { messages: out, system: systemTexts.join("\n\n") };
}

function convertTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return [];
  const result = [];
  for (const t of tools) {
    if (!t) continue;
    if (t.type === OPENAI_BLOCK.FUNCTION && t.function) {
      result.push({
        type: OPENAI_BLOCK.FUNCTION,
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters || { type: "object" },
      });
    } else if (t.name && (t.input_schema || t.parameters)) {
      result.push({
        type: OPENAI_BLOCK.FUNCTION,
        name: t.name,
        description: t.description,
        input_schema: t.input_schema || t.parameters,
      });
    }
  }
  return result;
}

export function openaiToCommandCodeRequest(model, body, stream /* , credentials */) {
  const { messages, system } = convertMessages(body.messages);
  const requestedMaxTokens = body.max_tokens ?? body.max_output_tokens ?? DEFAULT_MAX_TOKENS;
  const params = {
    model,
    messages,
    tools: convertTools(body.tools),
    stream: stream !== false,
    max_tokens: Math.min(Math.max(Number(requestedMaxTokens) || DEFAULT_MAX_TOKENS, 1), 200_000),
  };

  if (system) params.system = system;

  const today = new Date().toISOString().slice(0, 10);

  return {
    memory: "",
    taste: "",
    skills: null,
    permissionMode: "standard",
    config: {
      workingDir: "/",
      date: today,
      environment: `${process.platform}-${process.arch}, 9router proxy`,
      structure: [],
      isGitRepo: false,
      currentBranch: "",
      mainBranch: "",
      gitStatus: "",
      recentCommits: [],
    },
    params,
  };
}

register(FORMATS.OPENAI, FORMATS.COMMANDCODE, openaiToCommandCodeRequest, null);
