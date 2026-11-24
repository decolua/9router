/**
 * Server-side web search shim for /v1/messages (Claude-format) clients.
 *
 * WHY
 * Claude Code's built-in WebSearch is a SERVER-SIDE tool: the CLI sends
 *   tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }]
 *   tool_choice: { type: "tool", name: "web_search" }        // forced
 * and parses the streamed response for `server_tool_use` and
 * `web_search_tool_result` content blocks.
 *
 * Upstreams we fan out to (e.g. api.pateway.ai) implement no server-side search.
 * Worse, the claude-format tools list is normalized to OpenAI `function` tools on
 * the way out (translator/request/claude-to-openai.js), so the server tool becomes
 * a phantom function: the model happily echoes `web_search` back as a tool call and
 * nothing ever executes it. The client sees an empty result set, with no error.
 *
 * WHAT THIS DOES
 * Detects that a client asked for web search, runs the search OURSELVES through
 * 9router's own search provider pool (the "search-combo" combo — gemini,
 * antigravity, exa, brave-search, serper, tavily, searchapi, ollama-search), and
 * returns an Anthropic-shaped answer containing the real blocks the client expects.
 * No upstream model call is made for these requests: a forced single-tool turn needs
 * no reasoning, which also removes the gateway-injected style-prompt risk (see the
 * caveman/ponytail quirks) and never bills an upstream completion.
 *
 * SCOPE / SAFETY
 * - Only fires when the client FORCED a single search tool
 *   (tool_choice.type === "tool" and the named tool is a search tool). Pass-through
 *   chat traffic carrying web_search among many tools is untouched — that keeps the
 *   blast radius tiny for the ~400 connections sharing this router.
 * - Streaming and non-streaming clients are both served.
 * - Any failure falls back to `null`, and the caller proceeds with the normal
 *   upstream request. This module must never make a request worse than it was.
 */

import { getCombos } from "@/lib/localDb";
import { AI_PROVIDERS, resolveProviderId } from "@/shared/constants/providers.js";
import { getProviderCredentials } from "@/sse/services/auth.js";
import { handleSearchCore } from "./search/index.js";
import { getComboModelsFromData } from "../services/combo.js";
import { FORMATS } from "../translator/formats.js";
import { formatSSE, SSE_DONE, SSE_HEADERS } from "../utils/stream.js";
import { detectForcedWebSearch, serverToolUseId } from "./webSearchDetect.js";

const DEFAULT_COMBO = "search-combo";

/**
 * Run a web search through 9router's own search pool, in-process.
 * Mirrors src/sse/handlers/search.js without the HTTP/auth layer.
 * @returns {Promise<{provider:string, results:Array}|null>} null on any failure.
 */
export async function runWebSearch({ query, maxResults, log }) {
  try {
    const combos = await getCombos();

    let comboModels = null;
    try {
      comboModels = getComboModelsFromData(DEFAULT_COMBO, combos);
    } catch (err) {
      log?.warn?.("WEBSEARCH", `combo "${DEFAULT_COMBO}" lookup failed: ${err?.message || err}`);
      comboModels = null;
    }

    // Fall back to first enabled search provider if the combo is missing/disabled.
    const providers = (Array.isArray(comboModels) && comboModels.length
      ? comboModels
      : Object.keys(AI_PROVIDERS).filter((id) => {
          const p = AI_PROVIDERS[id];
          return !!p && (!!p.searchConfig || !!p.searchViaChat);
        })
    ).slice(0, 8);

    if (!providers.length) {
      log?.warn?.("WEBSEARCH", "no search providers available");
      return null;
    }

    for (const candidate of providers) {
      try {
        const providerId = resolveProviderId(candidate);
        const resolved = AI_PROVIDERS[providerId];
        if (!resolved) continue;

        const providerConfig = resolved.searchConfig;
        if (!providerConfig && !resolved.searchViaChat) continue;

        const credentials = await getProviderCredentials(providerId, [], null).catch(() => null);
        if (providerConfig?.authType !== "none" && !credentials) continue;

        const out = await handleSearchCore({
          body: { query, max_results: maxResults, search_type: "web" },
          provider: resolved,
          providerConfig,
          credentials,
          log,
        });

        if (out?.success && Array.isArray(out.data?.results) && out.data.results.length) {
          return { provider: out.data.provider || providerId, results: out.data.results };
        }
      } catch (err) {
        log?.warn?.("WEBSEARCH", `provider ${candidate} failed: ${err?.message || err}`);
      }
    }

    log?.warn?.("WEBSEARCH", `no provider returned results for "${String(query).slice(0, 60)}"`);
    return null;
  } catch (err) {
    log?.error?.("WEBSEARCH", `search failed: ${err?.message || err}`);
    return null;
  }
}

function buildServerBlocks({ toolUseId, query, results }) {
  const webResults = (results || []).map((r) => ({
    type: "web_search_result",
    title: typeof r.title === "string" ? r.title : "",
    url: typeof r.url === "string" ? r.url : "",
    encrypted_content: null,
    page_age: r.published_at ?? null,
  }));

  return [
    { type: "server_tool_use", id: toolUseId, name: "web_search", input: { query } },
    { type: "web_search_tool_result", tool_use_id: toolUseId, content: webResults },
  ];
}

/** Non-streaming: a plain Anthropic message. */
function buildMessage({ blocks, model, usage }) {
  return {
    id: `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
    type: "message",
    role: "assistant",
    model,
    content: blocks,
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: usage || { input_tokens: 0, output_tokens: 0 },
  };
}

/** Streaming: the Anthropic SSE event sequence, framed with the shared helpers. */
function buildSseBody({ blocks, model }) {
  const events = [];
  const push = (type, payload) => events.push({ type, ...payload });

  push("message_start", {
    message: {
      id: `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  });

  blocks.forEach((block, index) => {
    if (block.type === "server_tool_use") {
      // Anthropic opens the block with an empty input and streams the args as JSON.
      push("content_block_start", { index, content_block: { ...block, input: {} } });
      push("content_block_delta", {
        index,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input || {}) },
      });
      push("content_block_stop", { index });
      return;
    }
    push("content_block_start", { index, content_block: block });
    push("content_block_stop", { index });
  });

  push("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 0 } });
  push("message_stop", {});

  // formatSSE handles the Claude `event:` + `data:` framing (incl. usage hygiene).
  return events.map((e) => formatSSE(e, FORMATS.CLAUDE)).join("") + SSE_DONE;
}

const RESPONSE_HEADERS = { ...SSE_HEADERS, "Access-Control-Allow-Origin": "*" };

/**
 * Short-circuit entry point. Returns a Response for a forced web-search turn, or
 * null to let the normal upstream flow proceed.
 *
 * @param {object}  opts
 * @param {object}  opts.body            inbound client body
 * @param {string}  opts.sourceFormat    detected client format
 * @param {string}  opts.model           upstream model id (echoed back to the client)
 * @param {object} [opts.log]
 */
export async function maybeHandleWebSearch({ body, sourceFormat, model, log } = {}) {
  try {
    if (sourceFormat !== "claude") return null;

    const hit = detectForcedWebSearch(body);
    if (!hit) return null;

    const toolUseId = serverToolUseId();
    const { query, maxResults } = hit;

    log?.info?.("WEBSEARCH", `forced web_search | "${query.slice(0, 80)}" | max=${maxResults}`);

    const searched = await runWebSearch({ query, maxResults, log });
    // No results still deserves a well-formed answer: emitting an empty result set is
    // strictly better than forwarding a phantom tool call upstream.
    const blocks = buildServerBlocks({
      toolUseId,
      query,
      results: searched?.results || [],
    });

    log?.info?.("WEBSEARCH", `served via ${searched?.provider || "none"} | ${searched?.results?.length || 0} results`);

    const response = body.stream === true
      ? new Response(buildSseBody({ blocks, model }), { status: 200, headers: RESPONSE_HEADERS })
      : Response.json(buildMessage({ blocks, model }), { status: 200 });

    // MUST be the {success, response} envelope: handleChatCore callers gate on it.
    //   src/sse/handlers/chat.js:325          if (result.success) return result.response;
    //   open-sse/handlers/responsesHandler.js if (!result.success || !result.response) return result;
    // A bare Response reads as `success === undefined`, so the account-rotation loop treats
    // this turn as a FAILED account, marks it unavailable and rotates to the next one, calling
    // back into handleChatCore and re-entering this shim. With ~192 pooled accounts that is
    // unbounded — observed 192 shim executions from a single probe, and the client never got a reply.
    return { success: true, response };
  } catch (err) {
    log?.error?.("WEBSEARCH", `shim failed, deferring to upstream: ${err?.message || err}`);
    return null;
  }
}
