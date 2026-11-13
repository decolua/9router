// Pure helpers for the retained-payload prompt view: message extraction,
// attachment chips and tool-block descriptions. Kept free of JSX so unit
// tests can import them directly (see tests/unit/prompt-chat-system.test.js).


// Attachment kinds understood by the chip renderer. Everything recognized
// becomes a labeled chip (with an inline thumbnail for images); unrecognized
// blocks fall back to JSON as before.
export function describeAttachment(block) {
  // OpenAI chat: image_url (string or {url}); Responses API: input_image
  const imageUrl = typeof block?.image_url === "string" ? block.image_url : block?.image_url?.url
    || (block?.type === "input_image" ? (block.image_url || block.file_id) : null);
  if (imageUrl) {
    const mime = /^data:([^;,]+)/.exec(imageUrl)?.[1] || (imageUrl.startsWith("http") ? "image/*" : "image");
    const size = estimateAttachmentBytes(imageUrl);
    return { kind: "image", label: "Image", mime, url: imageUrl, size };
  }
  // Claude: image {source:{type,data,media_type|url}}; document (PDF) likewise
  if (block?.source?.type === "base64" || block?.source?.type === "url") {
    const mime = block.source.media_type
      || (block.source.type === "url" && /\.(png|jpe?g|gif|webp|bmp|svg)$/i.exec(block.source.url || "")?.[1] ? `image/${RegExp.$1 === "jpg" ? "jpeg" : RegExp.$1}` : null)
      || (block.type === "image" ? "image/*" : block.type === "document" ? "application/pdf" : "application/octet-stream");
    const kind = mime.startsWith("image/") ? "image" : mime.startsWith("audio/") ? "audio" : "file";
    const url = block.source.type === "url" ? block.source.url : `data:${mime};base64,${block.source.data || ""}`;
    return { kind, label: kind === "image" ? "Image" : kind === "audio" ? "Audio" : "Document", mime, url: block.source.type === "url" ? undefined : url, size: estimateAttachmentBytes(block.source.data || "") };
  }
  // Gemini: inlineData/fileData parts
  const inline = block?.inlineData || block?.inline_data;
  if (inline?.data || inline?.uri) {
    const mime = inline.mimeType || inline.mime_type || "application/octet-stream";
    const kind = mime.startsWith("image/") ? "image" : mime.startsWith("audio/") ? "audio" : "file";
    return { kind, label: kind === "image" ? "Image" : kind === "audio" ? "Audio" : "Document", mime, url: inline.uri ? undefined : `data:${mime};base64,${inline.data}`, size: estimateAttachmentBytes(inline.data || "") };
  }
  const fileData = block?.fileData || block?.file_data;
  if (fileData?.fileUri || fileData?.file_uri || fileData?.mimeType) {
    return { kind: "file", label: "File", mime: fileData.mimeType || fileData.mime_type || "unknown", uri: fileData.fileUri || fileData.file_uri };
  }
  // OpenAI audio blocks
  if (block?.input_audio?.data || block?.audio_url?.url || block?.type === "input_audio") {
    const data = block.input_audio?.data;
    const format = block.input_audio?.format || /^data:audio\/([^;,]+)/.exec(block.audio_url?.url || "")?.[1] || "audio";
    return { kind: "audio", label: "Audio", mime: `audio/${format}`, url: data ? `data:audio/${format};base64,${data}` : block.audio_url?.url, size: estimateAttachmentBytes(data || "") };
  }
  // OpenAI file blocks (file_id references)
  if (block?.type === "file" || block?.file_id || block?.type === "input_file") {
    return { kind: "file", label: "File", mime: block?.filename || block?.file?.filename || "file", fileId: block.file_id || block.file?.file_id };
  }
  return null;
}

export function estimateAttachmentBytes(base64) {
  if (!base64 || typeof base64 !== "string") return null;
  const comma = base64.indexOf(",");
  const payload = comma >= 0 ? base64.slice(comma + 1) : base64;
  if (!payload) return null;
  return Math.floor(payload.length * 3 / 4);
}

export function prettyJsonIfPossible(raw) {
  if (typeof raw !== "string") return raw;
  const trimmed = raw.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return raw;
  try { return JSON.stringify(JSON.parse(trimmed), null, 2); } catch { return raw; }
}

// Best-effort tool-call description across wire formats. Shapes seen in this
// repo's translators: OpenAI chat (tool_calls[] / role:"tool"), Claude
// (tool_use / tool_result blocks), Gemini (functionCall / functionResponse
// parts), Responses API (function_call / function_call_output items).
// Anything unrecognized returns null and falls back to text/JSON rendering.
export function describeToolBlock(block) {
  // Claude tool_use / OpenAI assistant tool_calls entry
  const fn = block?.type === "tool_use" ? block
    : block?.function || (block?.type === "function_call" ? block : null);
  if (fn && (fn.name || fn.function?.name)) {
    const name = fn.name || fn.function?.name;
    const rawArgs = fn.input ?? fn.arguments ?? fn.function?.arguments ?? {};
    let args = rawArgs;
    let argsTruncated = false;
    if (typeof rawArgs === "string") {
      try { args = JSON.parse(rawArgs); } catch { args = rawArgs; argsTruncated = true; }
    }
    return { kind: "call", id: block.id || fn.id || fn.call_id || null, name, args, argsTruncated };
  }
  // Claude tool_result
  if (block?.type === "tool_result") {
    const raw = typeof block.content === "string" ? block.content
      : Array.isArray(block.content) ? block.content.map((c) => contentToText(c)).join("\n")
      : JSON.stringify(block.content ?? null);
    return { kind: "result", id: block.tool_use_id || block.call_id || null, name: null, output: prettyJsonIfPossible(raw), isError: block.is_error === true };
  }
  // OpenAI tool message (whole message, not block)
  if (block?.role === "tool") {
    const raw = typeof block.content === "string" ? block.content
      : Array.isArray(block.content) ? block.content.map((c) => contentToText(c)).join("\n")
      : JSON.stringify(block.content ?? null);
    return { kind: "result", id: block.tool_call_id || null, name: null, output: prettyJsonIfPossible(raw), isError: false };
  }
  // Gemini functionCall part
  if (block?.functionCall || block?.function_call) {
    const fc = block.functionCall || block.function_call;
    return { kind: "call", id: null, name: fc.name || "unknown", args: fc.args ?? fc.args_json ?? {} };
  }
  // Gemini functionResponse part / Responses API function_call_output
  const fr = block?.functionResponse || block?.function_response;
  if (fr) {
    const out = fr.response ?? fr.output ?? fr;
    return { kind: "result", id: block.call_id || fr.call_id || null, name: fr.name || null, output: typeof out === "string" ? prettyJsonIfPossible(out) : JSON.stringify(out, null, 2) };
  }
  if (block?.type === "function_call_output" && block.call_id != null) {
    const out = block.output ?? "";
    return { kind: "result", id: block.call_id, name: null, output: typeof out === "string" ? out : JSON.stringify(out) };
  }
  // OpenAI assistant message carrying tool_calls[] (message-level, passed whole)
  if (Array.isArray(block?.tool_calls)) return { kind: "calls", calls: block.tool_calls.map(describeToolBlock).filter(Boolean) };
  return null;
}

export function formatBytes(bytes) {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function contentToText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    // Content-block arrays: text renders as text, attachments/tools as [Label] chips
    return content.map((block) => {
      if (typeof block === "string") return block;
      if (block?.type === "text" || block?.type === "input_text" || block?.text != null && typeof block.text === "string" && !block.type) return block.text || "";
      const tool = describeToolBlock(block);
      if (tool) {
        if (tool.kind === "call") return `[tool:call] ${tool.name}`;
        if (tool.kind === "result") return `[tool:result] ${tool.name || tool.id || ""}`.trim();
        if (tool.kind === "calls") return tool.calls.map((c) => `[tool:call] ${c.name}`).join("\n");
      }
      if (describeAttachment(block)) return `[${describeAttachment(block).label}]`;
      return JSON.stringify(block);
    }).join("\n");
  }
  if (typeof content === "object") {
    const tool = describeToolBlock(content);
    if (tool) {
      if (tool.kind === "call") return `[tool:call] ${tool.name}`;
      if (tool.kind === "result") return `[tool:result] ${tool.name || tool.id || ""}`.trim();
      if (tool.kind === "calls") return tool.calls.map((c) => `[tool:call] ${c.name}`).join("\n");
    }
    const att = describeAttachment(content);
    return att ? `[${att.label}]` : JSON.stringify(content, null, 2);
  }
  return String(content);
}

export function extractMessages(request) {
  // Top-level system prompt (Anthropic /v1/messages: string or content-block
  // array; OpenAI Responses: instructions) — surface it as the first message
  // so Original/Client views show what the client actually sent.
  let systemMessages = [];
  if (request?.system != null && request.system !== "") {
    const text = contentToText(request.system);
    if (text) systemMessages.push({ role: "system", content: text });
  } else if (typeof request?.instructions === "string" && request.instructions) {
    systemMessages.push({ role: "system", content: request.instructions });
  }
  if (Array.isArray(request?.messages)) return [...systemMessages, ...request.messages];
  // OpenAI Responses API input
  if (Array.isArray(request?.input)) {
    const input = request.input.map((item) => ({
      role: item.role || (item.type === "message" ? "user" : "tool") || "user",
      content: contentToText(item.content ?? item.text ?? item),
    }));
    return [...systemMessages, ...input];
  }
  // Gemini-style contents
  if (Array.isArray(request?.contents)) {
    // Gemini carries the system prompt in systemInstruction, not contents.
    const si = request.systemInstruction || request.system_instruction;
    const siText = si ? contentToText(si.parts ?? si) : "";
    if (siText && !systemMessages.length) systemMessages.push({ role: "system", content: siText });
    return [...systemMessages, ...request.contents.map((c) => ({ role: c.role === "model" ? "assistant" : (c.role || "user"), content: contentToText(c.parts) }))];
  }
  // Single-string prompts (completions, TTS/STT bodies)
  if (typeof request?.prompt === "string") return [...systemMessages, { role: "user", content: request.prompt }];
  if (typeof request?.input === "string") return [...systemMessages, { role: "user", content: request.input }];
  return systemMessages;
}

export const ROLE_STYLES = {
  system: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  user: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  assistant: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  tool: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
};

export const ROLE_DOT = {
  system: "bg-violet-500",
  user: "bg-emerald-500",
  assistant: "bg-sky-500",
  tool: "bg-amber-500",
};

export function estimateTokens(text) {
  return Math.ceil((text || "").length / 4);
}
