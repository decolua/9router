import { randomUUID } from "node:crypto";
import { handleSearch } from "@/sse/handlers/search.js";
import { buildModelsList } from "@/app/api/v1/models/route.js";

const MAX_SEARCH_ROUNDS = 4;
const SSE_HEADERS = { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" };

export function webSearchTool(searchContextSize) {
  const maxResults = searchContextSize === "low" ? 3 : searchContextSize === "high" ? 8 : 5;
  return {
    type: "function",
    name: "web_search",
    description: "Search the public web with 9router's configured web-search provider. Use it for facts, documentation, or current events that are not already available in the conversation.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        search_type: { type: "string", enum: ["web", "news"], description: "Search general web results or news" },
        max_results: { type: "integer", minimum: 1, maximum: 10, description: `Maximum results (default ${maxResults})` },
      },
      required: ["query"],
      additionalProperties: false,
    },
  };
}

function findHostedSearchTool(tools) {
  return (tools || []).find(tool => tool?.type === "web_search" || tool?.type === "web_search_preview");
}

export function hasHostedWebSearch(body) {
  if (findHostedSearchTool(body?.tools)) return true;
  return Array.isArray(body?.input)
    && body.input.some(item => item?.type === "additional_tools" && findHostedSearchTool(item.tools));
}

export function prepareWebSearchRequest(body) {
  const replace = tools => tools?.map(tool => tool?.type === "web_search" || tool?.type === "web_search_preview"
    ? webSearchTool(tool.search_context_size) : tool);

  const prepared = { ...body, tools: replace(body.tools) };
  if (Array.isArray(body.input)) {
    prepared.input = body.input.map(item => item?.type === "additional_tools"
      ? { ...item, tools: replace(item.tools) } : item);
  }
  return prepared;
}

export async function resolveWebSearchModel(saved) {
  if (typeof saved === "string" && saved.trim()) return saved.trim();
  try {
    const available = await buildModelsList(["webSearch"]);
    return available.find(model => model?.kind === "webSearch")?.id || null;
  } catch {
    return null;
  }
}

function parseArguments(value) {
  if (typeof value !== "string") return value && typeof value === "object" ? value : {};
  try { return JSON.parse(value) || {}; } catch { return {}; }
}

async function executeSearch({ requestUrl, apiKey, model, call, signal }) {
  const args = parseArguments(call.arguments);
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const failed = message => ({
    item: {
      id: `ws_${randomUUID()}`, type: "web_search_call", status: "failed",
      action: { type: "search", query }, results: [],
    },
    output: JSON.stringify({ error: message }),
  });

  if (!model) return { ...failed("No active 9router web-search provider is configured."), callId: call.call_id };
  if (!query) return { ...failed("The model did not provide a non-empty web_search query."), callId: call.call_id };
  signal?.throwIfAborted();

  const response = await handleSearch(new Request(new URL("/v1/search", requestUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      provider: model,
      query,
      search_type: args.search_type === "news" ? "news" : "web",
      max_results: Number.isInteger(args.max_results) ? Math.min(Math.max(args.max_results, 1), 10) : undefined,
    }),
    signal,
  }));
  const data = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(data?.results)) {
    const message = data?.error?.message || data?.error || `Web search failed (HTTP ${response.status}).`;
    return failed(typeof message === "string" ? message : JSON.stringify(message));
  }

  const results = data.results.map(result => ({
    title: result.title || "",
    url: result.url || "",
    snippet: result.snippet || "",
    published_at: result.published_at || null,
  }));
  return {
    item: {
      id: `ws_${randomUUID()}`, type: "web_search_call", status: "completed",
      action: { type: "search", query }, results,
    },
    callId: call.call_id,
    output: JSON.stringify({ query, provider: data.provider || model, results }),
  };
}

function normalizeResult(result, model) {
  return {
    ...result,
    id: result.id || `resp_${randomUUID()}`,
    object: result.object || "response",
    created_at: result.created_at || Math.floor(Date.now() / 1000),
    model: result.model || model,
    status: result.status || "completed",
  };
}

function sseResponse(result) {
  const events = [];
  const emit = (type, data) => events.push(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: events.length + 1, ...data })}\n\n`);
  const inProgress = { ...result, status: "in_progress", output: [] };
  emit("response.created", { response: inProgress });
  emit("response.in_progress", { response: inProgress });
  (result.output || []).forEach((item, output_index) => {
    emit("response.output_item.added", { output_index, item });
    if (item?.type === "message" && Array.isArray(item.content)) {
      item.content.forEach((part, content_index) => {
        emit("response.content_part.added", { item_id: item.id, output_index, content_index, part: { ...part, text: "" } });
        if (typeof part?.text === "string" && part.text) {
          emit("response.output_text.delta", { item_id: item.id, output_index, content_index, delta: part.text });
        }
        emit("response.content_part.done", { item_id: item.id, output_index, content_index, part });
        if (typeof part?.text === "string") emit("response.output_text.done", { item_id: item.id, output_index, content_index, text: part.text });
      });
    }
    if (item?.type === "function_call") {
      const argumentsText = item.arguments || "";
      if (argumentsText) emit("response.function_call_arguments.delta", { item_id: item.id, output_index, delta: argumentsText });
      emit("response.function_call_arguments.done", { item_id: item.id, output_index, arguments: argumentsText });
    }
    emit("response.output_item.done", { output_index, item });
  });
  emit("response.completed", { response: result });
  return new Response(events.join(""), { headers: SSE_HEADERS });
}

function responseError(error, signal) {
  if (error instanceof Response) return error;
  return Response.json({ error: { message: error?.message || "Codex web search failed." } }, {
    status: signal?.aborted ? 499 : 502,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function runWebSearchLoop({ body, invoke, requestUrl, apiKey, searchModel, signal }) {
  const requestedStream = body.stream === true;
  let request = prepareWebSearchRequest({ ...body, stream: false });
  let searchItems = [];
  try {
    for (let round = 0; round < MAX_SEARCH_ROUNDS; round++) {
      signal?.throwIfAborted();
      const response = await invoke(request, signal);
      if (!response.ok) return response;
      let data;
      try { data = await response.json(); }
      catch { throw new Error("The selected model returned invalid JSON while using web_search."); }

      const output = Array.isArray(data.output) ? data.output : [];
      const searchCalls = output.filter(item => item?.type === "function_call" && item.name === "web_search");
      if (!searchCalls.length) {
        const result = normalizeResult({ ...data, output: [...searchItems, ...output] }, body.model);
        return requestedStream ? sseResponse(result) : Response.json(result, { headers: { "Cache-Control": "no-store" } });
      }

      const executed = [];
      for (const call of searchCalls) {
        executed.push(await executeSearch({ requestUrl, apiKey, model: searchModel, call, signal }));
      }
      searchItems = [...searchItems, ...executed.map(result => result.item)];

      // A non-search client tool must be returned to Codex for execution. The
      // completed server search items remain in that response for its next turn.
      const clientToolCall = output.some(item => item?.type === "custom_tool_call" ||
        (item?.type === "function_call" && item.name !== "web_search"));
      if (clientToolCall) {
        const converted = output.map(item => {
          const index = searchCalls.indexOf(item);
          return index >= 0 ? executed[index].item : item;
        });
        const result = normalizeResult({
          ...data, output: [...searchItems.slice(0, -searchCalls.length), ...converted],
        }, body.model);
        return requestedStream
          ? sseResponse(result)
          : Response.json(result, { headers: { "Cache-Control": "no-store" } });
      }

      request = {
        ...request,
        input: [...(request.input || []), ...output, ...executed.map(result => ({
          type: "function_call_output", call_id: result.callId, output: result.output,
        }))],
      };
    }
    throw new Error("The selected model exceeded the web_search round limit.");
  } catch (error) {
    return responseError(error, signal);
  }
}
