import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import crypto from "crypto";

const KIMI_CHAT_API = "https://www.kimi.com/apiv2/kimi.gateway.chat.v1.ChatService/Chat";
const KIMI_SCENARIO = "SCENARIO_K2D5";
const THINKING_STAGE_NAME = "STAGE_NAME_THINKING";
const FAKE_HEADERS = {
  "Accept": "*/*",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
  "Origin": "https://www.kimi.com",
  "R-Timezone": "Asia/Shanghai",
  "Sec-Ch-Ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Priority": "u=1, i",
  "X-Msh-Platform": "web",
};

// Local cache to track active chat ID and last message ID for multi-turn threads
const sessionCache = new Map(); // conversationId -> { chatId, lastMessageId }

function generate19DigitId() {
  return Math.floor(7000000000000000000 + Math.random() * 1000000000000000000).toString();
}

function parseJwt(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - payload.length % 4) % 4);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function extractDeviceId(token) {
  const jwt = parseJwt(token);
  return jwt?.device_id || generate19DigitId();
}

function formatMessages(messages) {
  const systemLines = [];
  const bodyLines = [];

  for (const message of messages) {
    let role = message.role;
    let content = message.content;
    if (Array.isArray(content)) {
      content = content.filter(c => c.type === "text").map(c => c.text).join(" ");
    }
    let text = String(content || "").trim();

    if (role === "assistant" && message.tool_calls && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      const toolCallsText = message.tool_calls
        .map(call => {
          const name = call.function?.name || "";
          const args = typeof call.function?.arguments === "string"
            ? call.function.arguments
            : JSON.stringify(call.function?.arguments || {});
          return `[call:${name}]${args}[/call]`;
        })
        .join("\n")
        .trim();
      if (toolCallsText) {
        text = `[function_calls]\n${toolCallsText}\n[/function_calls]`;
      }
    }

    if ((role === "tool" || role === "function") && (message.tool_call_id || message.name)) {
      role = "user";
      const id = message.tool_call_id || message.name;
      text = `[TOOL_RESULT for ${id}] ${text}`.trim();
    }

    if (!text) continue;

    if (role === "system") {
      systemLines.push(text);
    } else {
      if (role === "developer") role = "system";
      bodyLines.push(`${role}:${text}`);
    }
  }

  return [...systemLines.map(line => `system:${line}`), ...bodyLines].join("\n").trim();
}

function encodeConnectRequest(payload) {
  const body = JSON.stringify(payload);
  const bodyBytes = new TextEncoder().encode(body);
  const header = new Uint8Array(5);
  header[0] = 0x00;
  
  const len = bodyBytes.length;
  header[1] = (len >> 24) & 0xff;
  header[2] = (len >> 16) & 0xff;
  header[3] = (len >> 8) & 0xff;
  header[4] = len & 0xff;

  const merged = new Uint8Array(5 + len);
  merged.set(header, 0);
  merged.set(bodyBytes, 5);
  return merged;
}

async function* readGrpcEvents(bodyReader, signal) {
  let buffer = new Uint8Array(0);
  const decoder = new TextDecoder();
  
  try {
    while (true) {
      if (signal?.aborted) return;
      const { value, done } = await bodyReader.read();
      if (done) break;
      
      const newBuffer = new Uint8Array(buffer.length + value.length);
      newBuffer.set(buffer, 0);
      newBuffer.set(value, buffer.length);
      buffer = newBuffer;
      
      let offset = 0;
      while (offset + 5 <= buffer.length) {
        const flag = buffer[offset];
        const length = (buffer[offset + 1] << 24) |
                       (buffer[offset + 2] << 16) |
                       (buffer[offset + 3] << 8)  |
                       buffer[offset + 4];
        
        const frameEnd = offset + 5 + length;
        if (frameEnd > buffer.length) {
          break;
        }
        
        const payload = buffer.subarray(offset + 5, frameEnd);
        offset = frameEnd;
        
        if (flag & 0x80) {
          continue;
        }
        
        const text = decoder.decode(payload).trim();
        if (!text) continue;
        
        try {
          const event = JSON.parse(text);
          yield event;
        } catch (e) {
          // ignore parsing error
        }
      }
      
      if (offset > 0) {
        buffer = buffer.subarray(offset);
      }
    }
  } finally {
    bodyReader.releaseLock();
  }
}

function extractPhase(event, currentPhase) {
  const stages = event.block?.multiStage?.stages || [];
  if (stages.length > 0) {
    const firstStage = stages[0];
    if (firstStage.name === THINKING_STAGE_NAME) {
      return firstStage.status === "completed" ? "answer" : "thinking";
    }
  }
  
  const flags = event.block?.text?.flags;
  if (flags === "thinking") return "thinking";
  if (flags === "answer") return "answer";
  return currentPhase;
}

function extractDelta(event, currentPhase) {
  if (event.heartbeat) {
    return { phase: currentPhase, content: null, reasoningContent: null };
  }
  
  const phase = extractPhase(event, currentPhase);
  const mask = event.mask || "";
  
  if (mask.includes("block.think")) {
    return {
      phase,
      content: null,
      reasoningContent: event.block?.think?.content || null
    };
  }
  
  if (mask.includes("block.text")) {
    const content = event.block?.text?.content || null;
    if (phase === "thinking") {
      return { phase, content: null, reasoningContent: content };
    }
    return { phase, content, reasoningContent: null };
  }
  
  const content = event.block?.text?.content || null;
  if (phase === "thinking") {
    return { phase, content: null, reasoningContent: content };
  }
  return { phase, content, reasoningContent: null };
}

function sseChunk(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function buildStreamingResponse(responseBody, model, cid, created, sessionKey, signal) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null, logprobs: null }],
        })));

        let currentPhase = null;
        const reader = responseBody.getReader();

        let isToolCallStream = undefined; // undefined = buffering, true = yes, false = no
        let initialBuffer = "";
        let contentBuffer = "";
        let sentToolCalls = []; // elements: { id, name, arguments }
        let emittedPostTextLength = 0;

        function parseAndStreamToolCalls() {
          const callRegex = /\[call:([^\]]+)\]([\s\S]*?)(?:\[\/call\]|$)/g;
          let match;
          let idx = 0;
          while ((match = callRegex.exec(contentBuffer)) !== null) {
            const toolName = match[1].trim();
            const toolArgs = match[2];

            if (!sentToolCalls[idx]) {
              const toolCallId = `call_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
              sentToolCalls[idx] = {
                id: toolCallId,
                name: toolName,
                arguments: ""
              };
              // Emit tool call start
              controller.enqueue(encoder.encode(sseChunk({
                id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
                choices: [{
                  index: 0,
                  delta: {
                    tool_calls: [{
                      index: idx,
                      id: toolCallId,
                      type: "function",
                      function: { name: toolName, arguments: "" }
                    }]
                  },
                  finish_reason: null,
                  logprobs: null
                }],
              })));
            }

            const prevArgs = sentToolCalls[idx].arguments;
            if (toolArgs.length > prevArgs.length) {
              const argDelta = toolArgs.slice(prevArgs.length);
              sentToolCalls[idx].arguments = toolArgs;
              // Emit tool call argument delta
              controller.enqueue(encoder.encode(sseChunk({
                id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
                choices: [{
                  index: 0,
                  delta: {
                    tool_calls: [{
                      index: idx,
                      function: { arguments: argDelta }
                    }]
                  },
                  finish_reason: null,
                  logprobs: null
                }],
              })));
            }
            idx++;
          }

          // Handle post-text after [/function_calls]
          const endTagIdx = contentBuffer.indexOf("[/function_calls]");
          if (endTagIdx !== -1) {
            const postText = contentBuffer.slice(endTagIdx + "[/function_calls]".length);
            if (postText.length > emittedPostTextLength) {
              const deltaText = postText.slice(emittedPostTextLength);
              emittedPostTextLength = postText.length;
              controller.enqueue(encoder.encode(sseChunk({
                id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
                choices: [{ index: 0, delta: { content: deltaText }, finish_reason: null, logprobs: null }],
              })));
            }
          }
        }

        for await (const event of readGrpcEvents(reader, signal)) {
          if (event.error) {
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
              choices: [{ index: 0, delta: { content: `[Error: ${event.error.message || JSON.stringify(event.error)}]` }, finish_reason: null, logprobs: null }],
            })));
            break;
          }

          // Update cache with chat ID and last assistant message ID
          const chatId = event.chat?.id;
          const msgId = event.message?.id;
          const isAssistant = event.message?.role === "assistant";
          
          if (chatId || (isAssistant && msgId)) {
            const cached = sessionCache.get(sessionKey) || {};
            if (chatId) cached.chatId = chatId;
            if (isAssistant && msgId) cached.lastMessageId = msgId;
            sessionCache.set(sessionKey, cached);
          }

          const delta = extractDelta(event, currentPhase);
          currentPhase = delta.phase;

          if (delta.reasoningContent) {
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
              choices: [{ index: 0, delta: { reasoning_content: delta.reasoningContent }, finish_reason: null, logprobs: null }],
            })));
          }
          if (delta.content) {
            if (isToolCallStream === false) {
              controller.enqueue(encoder.encode(sseChunk({
                id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
                choices: [{ index: 0, delta: { content: delta.content }, finish_reason: null, logprobs: null }],
              })));
            } else if (isToolCallStream === true) {
              contentBuffer += delta.content;
              parseAndStreamToolCalls();
            } else {
              initialBuffer += delta.content;
              const trimmed = initialBuffer.trimStart();
              if (trimmed.startsWith("[function_calls]")) {
                isToolCallStream = true;
                contentBuffer = trimmed;
                parseAndStreamToolCalls();
              } else if (trimmed.startsWith("[") && "[function_calls]".startsWith(trimmed)) {
                // Keep buffering
              } else {
                isToolCallStream = false;
                if (initialBuffer) {
                  controller.enqueue(encoder.encode(sseChunk({
                    id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
                    choices: [{ index: 0, delta: { content: initialBuffer }, finish_reason: null, logprobs: null }],
                  })));
                }
              }
            }
          }
          if (event.done) {
            break;
          }
        }

        // Flush any remaining buffers
        if (isToolCallStream === undefined) {
          isToolCallStream = false;
          if (initialBuffer) {
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
              choices: [{ index: 0, delta: { content: initialBuffer }, finish_reason: null, logprobs: null }],
            })));
          }
        } else if (isToolCallStream === true) {
          parseAndStreamToolCalls();
        }

        const finalFinishReason = sentToolCalls.length > 0 ? "tool_calls" : "stop";

        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: {}, finish_reason: finalFinishReason, logprobs: null }],
        })));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (err) {
        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: { content: `[Stream error: ${err.message || String(err)}]` }, finish_reason: "stop", logprobs: null }],
        })));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } finally {
        controller.close();
      }
    },
  });
}

async function buildNonStreamingResponse(responseBody, model, cid, created, sessionKey, signal) {
  let fullContent = "";
  const thinkingParts = [];
  const reader = responseBody.getReader();

  for await (const event of readGrpcEvents(reader, signal)) {
    if (event.error) {
      return new Response(JSON.stringify({
        error: { message: event.error.message || JSON.stringify(event.error), type: "upstream_error", code: "KIMI_ERROR" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
    }

    const chatId = event.chat?.id;
    const msgId = event.message?.id;
    const isAssistant = event.message?.role === "assistant";
    
    if (chatId || (isAssistant && msgId)) {
      const cached = sessionCache.get(sessionKey) || {};
      if (chatId) cached.chatId = chatId;
      if (isAssistant && msgId) cached.lastMessageId = msgId;
      sessionCache.set(sessionKey, cached);
    }

    const delta = extractDelta(event, null);
    if (delta.reasoningContent) thinkingParts.push(delta.reasoningContent);
    if (delta.content) fullContent += delta.content;
    if (event.done) break;
  }

  let cleanContent = fullContent;
  const toolCallsList = [];
  let finishReason = "stop";

  if (fullContent.includes("[function_calls]")) {
    const funcCallsRegex = /\[function_calls\]([\s\S]*?)\[\/function_calls\]/g;
    let match;
    while ((match = funcCallsRegex.exec(fullContent)) !== null) {
      const innerContent = match[1];
      const callRegex = /\[call:([^\]]+)\]([\s\S]*?)\[\/call\]/g;
      let callMatch;
      while ((callMatch = callRegex.exec(innerContent)) !== null) {
        const toolName = callMatch[1].trim();
        const toolArgs = callMatch[2].trim();
        toolCallsList.push({
          id: `call_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
          type: "function",
          function: {
            name: toolName,
            arguments: toolArgs
          }
        });
      }
    }
    if (toolCallsList.length > 0) {
      cleanContent = fullContent.replace(/\[function_calls\][\s\S]*?\[\/function_calls\]/g, "").trim();
      finishReason = "tool_calls";
    }
  }

  const msg = { role: "assistant", content: toolCallsList.length > 0 ? (cleanContent || null) : cleanContent };
  if (toolCallsList.length > 0) {
    msg.tool_calls = toolCallsList;
  }
  if (thinkingParts.length > 0) msg.reasoning_content = thinkingParts.join("");

  const promptTokens = Math.ceil((cleanContent || "").length / 4);
  const completionTokens = Math.ceil((cleanContent || "").length / 4);

  return new Response(JSON.stringify({
    id: cid, object: "chat.completion", created, model, system_fingerprint: null,
    choices: [{ index: 0, message: msg, finish_reason: finishReason, logprobs: null }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function formatKimiToolSchemas(tools) {
  const schemas = [];
  for (const t of tools) {
    if (!t || typeof t !== 'object') continue;
    const name = t.name || t.function?.name || "";
    const desc = t.description || t.function?.description || "No description available";
    const params = t.parameters || t.function?.parameters || {};
    schemas.push(`Tool: ${name}\nDescription: ${desc}\nParameters: ${JSON.stringify(params)}`);
  }
  return "You have access to these tools:\n\n" + schemas.join("\n\n");
}

function buildKimiToolCallInstructions() {
  return `TOOL CALL FORMAT — FOLLOW EXACTLY:

[function_calls]
[call:TOOL_NAME]arguments[/call]
[/function_calls]

RULES:
1) Use the [function_calls]...[/function_calls] wrapper format.
2) Put each tool call inside a [call:TOOL_NAME]arguments[/call] tag.
3) Put the parameters/arguments as a single JSON object string directly inside the call tag, like: [call:my_tool]{"param1": "value1"}[/call].
4) Do NOT write code blocks, markdown code fences, explanations, or any text before or after the [function_calls] block if you are calling a tool.
5) If you call a tool, the first characters of your output must be exactly [function_calls].`;
}

export class KimiFreeExecutor extends BaseExecutor {
  constructor() {
    super("kimi-free", PROVIDERS["kimi-free"] || {
      baseUrl: "https://www.kimi.com",
      format: "openai"
    });
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions }) {
    const token = credentials.accessToken || credentials.apiKey;
    if (!token) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Kimi Web Token (saved in API Key field) is required for kimi-free", type: "invalid_request" }
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: KIMI_CHAT_API, headers: {}, transformedBody: body };
    }

    const messages = body?.messages;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Missing or empty messages array", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: KIMI_CHAT_API, headers: {}, transformedBody: body };
    }

    // Inject tool schemas if available, and add Windows environment note
    let processedMessages = messages.map(m => ({ ...m }));
    const environmentPrompt = "\n\nIMPORTANT: Even if your system instructions mention being in a Linux sandbox, the local Windows file system (including drive D:/ and other drive paths) is fully mounted and accessible via your tools. You must call your tools directly to access these paths.";

    let systemFound = false;
    for (let i = 0; i < processedMessages.length; i++) {
      if (processedMessages[i].role === "system" || processedMessages[i].role === "developer") {
        let content = processedMessages[i].content || "";
        if (Array.isArray(body.tools) && body.tools.length > 0) {
          const toolsPrompt = formatKimiToolSchemas(body.tools) + "\n\n" + buildKimiToolCallInstructions();
          content = (content ? content + "\n\n" : "") + toolsPrompt;
        }
        processedMessages[i].content = content + environmentPrompt;
        systemFound = true;
        break;
      }
    }

    if (!systemFound) {
      let content = "";
      if (Array.isArray(body.tools) && body.tools.length > 0) {
        content = formatKimiToolSchemas(body.tools) + "\n\n" + buildKimiToolCallInstructions();
      }
      processedMessages.unshift({ role: "system", content: (content ? content + "\n\n" : "") + environmentPrompt });
    }

    // Resolve requested features based on model name
    const enableThinking = model.includes("-thinking") || model.includes("-reasoning");
    const enableWebSearch = model.includes("-search");

    // Format prompt
    const promptText = formatMessages(processedMessages);
    if (!promptText) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Empty query after processing messages", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: KIMI_CHAT_API, headers: {}, transformedBody: body };
    }

    // Lookup session cache
    const sessionKey = `${token.slice(-16)}:${body.conversation_id || "default"}`;
    const cachedSession = sessionCache.get(sessionKey) || {};

    const kimiMessage = {
      role: "user",
      blocks: [
        {
          message_id: "",
          text: { content: promptText }
        }
      ],
      scenario: KIMI_SCENARIO
    };
    if (cachedSession.lastMessageId) {
      kimiMessage.parent_id = cachedSession.lastMessageId;
    }

    const kimiPayload = {
      scenario: KIMI_SCENARIO,
      tools: enableWebSearch ? [{ type: "TOOL_TYPE_SEARCH", search: {} }] : [],
      message: kimiMessage,
      options: {
        thinking: enableThinking
      }
    };
    if (cachedSession.chatId) {
      kimiPayload.chat_id = cachedSession.chatId;
    }

    const deviceId = extractDeviceId(token);
    const sessionId = generate19DigitId();

    const headers = {
      ...FAKE_HEADERS,
      "Origin": "https://www.kimi.com",
      "X-Msh-Device-Id": deviceId,
      "X-Msh-Session-Id": sessionId,
      "Connect-Protocol-Version": "1",
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/connect+json"
    };

    const requestBody = encodeConnectRequest(kimiPayload);
    log?.info?.("KIMI-FREE", `Query to Kimi Web (thinking=${enableThinking}, search=${enableWebSearch}), len=${promptText.length}`);

    let response;
    try {
      response = await proxyAwareFetch(KIMI_CHAT_API, {
        method: "POST",
        headers,
        body: requestBody,
        signal
      }, proxyOptions);
    } catch (err) {
      log?.error?.("KIMI-FREE", `Fetch failed: ${err.message || String(err)}`);
      const errResp = new Response(JSON.stringify({
        error: { message: `Kimi connection failed: ${err.message || String(err)}`, type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: KIMI_CHAT_API, headers, transformedBody: kimiPayload };
    }

    if (!response.ok) {
      const status = response.status;
      let errMsg = `Kimi returned HTTP ${status}`;
      if (status === 401 || status === 403) {
        errMsg = "Kimi auth failed — token may be invalid or expired. Please re-paste your Kimi Web Token.";
      }
      log?.warn?.("KIMI-FREE", errMsg);
      const errResp = new Response(JSON.stringify({
        error: { message: errMsg, type: "upstream_error", code: `HTTP_${status}` },
      }), { status, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: KIMI_CHAT_API, headers, transformedBody: kimiPayload };
    }

    if (!response.body) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Kimi returned empty response body", type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: KIMI_CHAT_API, headers, transformedBody: kimiPayload };
    }

    const cid = `chatcmpl-kmf-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    let finalResponse;
    if (stream) {
      const sseStream = buildStreamingResponse(response.body, model, cid, created, sessionKey, signal);
      finalResponse = new Response(sseStream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" },
      });
    } else {
      finalResponse = await buildNonStreamingResponse(response.body, model, cid, created, sessionKey, signal);
    }

    return { response: finalResponse, url: KIMI_CHAT_API, headers, transformedBody: kimiPayload };
  }
}

export { formatMessages, buildStreamingResponse, buildNonStreamingResponse };
export default KimiFreeExecutor;
