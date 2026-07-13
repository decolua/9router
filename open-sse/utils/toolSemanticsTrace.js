import crypto from "node:crypto";
import { dbg, isDebugEnabled } from "./debugLog.js";

const TRACE_SECRET = crypto.randomBytes(32);

function digest(value) {
  const data = Array.isArray(value) ? value : [];
  if (data.length === 0) return "none";
  return crypto.createHmac("sha256", TRACE_SECRET)
    .update(JSON.stringify(data))
    .digest("hex")
    .slice(0, 12);
}

function toolNameFromDeclaration(tool) {
  return tool?.function?.name || tool?.name || tool?.functionDeclarations?.[0]?.name || tool?.function_declarations?.[0]?.name || "";
}

export function summarizeRequestTools(body) {
  const tools = [];
  const visitTools = (items) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      const declarations = item?.functionDeclarations || item?.function_declarations;
      if (Array.isArray(declarations)) {
        for (const decl of declarations) tools.push({ name: decl?.name || "" });
      } else {
        const name = toolNameFromDeclaration(item);
        if (name) tools.push({ name });
      }
    }
  };
  visitTools(body?.tools);
  visitTools(body?.request?.tools);
  visitTools(body?.tool_config?.tools);
  visitTools(body?.toolConfig?.tools);
  return { count: tools.length, digest: digest(tools) };
}

function extractToolCalls(body) {
  const calls = [];
  const add = (name, args) => {
    calls.push({
      name: name || "",
      arguments: typeof args === "string" ? args : JSON.stringify(args || {})
    });
  };

  for (const choice of body?.choices || []) {
    for (const call of choice?.message?.tool_calls || []) {
      const fn = call?.function || {};
      add(fn.name || call.name, fn.arguments || call.arguments);
    }
  }
  for (const item of body?.output || []) {
    if (item?.type === "function_call") add(item.name, item.arguments);
  }
  const responsesItem = body?.data?.item || body?.item;
  if (responsesItem?.type === "function_call") add(responsesItem.name, responsesItem.arguments);
  for (const block of body?.content || []) {
    if (block?.type === "tool_use") add(block.name, block.input);
  }
  const candidates = body?.response?.candidates || body?.candidates || [];
  for (const candidate of candidates) {
    for (const part of candidate?.content?.parts || []) {
      if (part?.functionCall) add(part.functionCall.name, part.functionCall.args);
    }
  }
  for (const call of body?.message?.tool_calls || []) {
    const fn = call?.function || {};
    add(fn.name || call.name, fn.arguments || call.arguments);
  }
  return calls;
}

export function summarizeToolCalls(body) {
  const calls = extractToolCalls(body);
  return { count: calls.length, digest: digest(calls) };
}

export function createToolCallTraceAccumulator() {
  const calls = [];
  const bySlot = new Map();
  const addSlot = (slot, name, args) => {
    const current = bySlot.get(slot) || { name: "", arguments: "" };
    if (name) current.name += name;
    if (args !== undefined) current.arguments += typeof args === "string" ? args : JSON.stringify(args || {});
    bySlot.set(slot, current);
  };
  return {
    push(body) {
      for (const choice of body?.choices || []) {
        for (const call of choice?.delta?.tool_calls || []) {
          const fn = call?.function || {};
          addSlot(`openai:${call.index ?? call.id ?? bySlot.size}`, fn.name || call.name || "", fn.arguments || call.arguments || "");
        }
      }
      if (body?.type === "content_block_start" && body?.content_block?.type === "tool_use") {
        addSlot(`claude:${body.index ?? bySlot.size}`, body.content_block.name || "", body.content_block.input || {});
      }
      if (body?.type === "content_block_delta" && body?.delta?.type === "input_json_delta") {
        addSlot(`claude:${body.index ?? bySlot.size}`, "", body.delta.partial_json || "");
      }
      const data = body?.data || body;
      if (data?.type === "response.output_item.added" && data.item?.type === "function_call") {
        addSlot(`responses:${data.output_index ?? data.item.call_id ?? bySlot.size}`, data.item.name || "", data.item.arguments || "");
      }
      if (data?.type === "response.function_call_arguments.delta") {
        addSlot(`responses:${data.output_index ?? data.item_id ?? bySlot.size}`, "", data.delta || "");
      }
      // addSlot is the single source of truth for Responses API streaming events
      // (response.output_item.added, response.function_call_arguments.delta, and
      // any future response.* variants). extractToolCalls would double-count via
      // body.data.item on both .added and .done events for the same logical call.
      // For non-streaming shapes (OpenAI completion, Claude message, Gemini
      // response, Ollama message), extractToolCalls still runs.
      const isResponsesStreamEvent = typeof data?.type === "string" && data.type.startsWith("response.");
      if (!isResponsesStreamEvent) calls.push(...extractToolCalls(body));
    },
    summary() {
      const merged = [...bySlot.values(), ...calls];
      return { count: merged.length, digest: digest(merged) };
    }
  };
}

function segment(label, summary) {
  return `${label}=${summary?.count || 0}:${summary?.digest || "none"}`;
}

export function isToolSemanticsDebugActive(log, fallback = isDebugEnabled) {
  return log?.debugEnabled === true || fallback === true;
}

export function logToolSemantics(log, options) {
  // Skip the full body-scan/HMAC work unless debug logging is active.
  if (!isToolSemanticsDebugActive(log)) return;
  const { source, target, mode, requestBody, translatedBody, providerBody, clientBody } = options;
  const requestTools = options.requestTools || summarizeRequestTools(requestBody);
  const translatedRequestTools = options.translatedRequestTools || summarizeRequestTools(translatedBody);
  const providerToolCalls = options.providerToolCalls || summarizeToolCalls(providerBody);
  const clientToolCalls = options.clientToolCalls || summarizeToolCalls(clientBody);
  const line = `source=${source} target=${target} mode=${mode} ${segment("requestTools", requestTools)} ${segment("translatedRequestTools", translatedRequestTools)} ${segment("providerToolCalls", providerToolCalls)} ${segment("clientToolCalls", clientToolCalls)}`;
  if (log?.debug) log.debug("TOOL-SEMANTICS", line);
  else dbg("TOOL-SEMANTICS", line);
}
