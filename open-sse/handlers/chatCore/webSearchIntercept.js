// Layer 0 of the native web_search redirect (ported from OmniRoute
// src/lib/skills/interception.ts). When webSearchFallback.js converted the client's
// built-in web-search tool into the 9router_web_search function tool and the upstream
// model called it, this runs the search through 9router's own /v1 search providers and
// rewrites the non-streaming response so the client sees completed search results
// instead of an unanswered tool call. Credential selection mirrors src/sse/handlers/
// search.js (account fallback + token refresh); combo names expand like there too.
// Fail-open: any error returns the original response untouched. Never logs credentials.
import { getProviderCredentials, markAccountUnavailable, clearAccountError } from "@/sse/services/auth.js";
import { updateProviderCredentials, checkAndRefreshToken } from "@/sse/services/tokenRefresh.js";
import { getSettings, getCombos } from "@/lib/localDb";
import { AI_PROVIDERS, resolveProviderId } from "@/shared/constants/providers.js";
import { getComboModelsFromData } from "../../services/combo.js";
import { handleSearchCore } from "../../handlers/search/index.js";
import { FORMATS } from "../../translator/formats.js";
import { CLAUDE_BLOCK, RESPONSES_ITEM, CLAUDE_STOP } from "../../translator/schema/index.js";

function toRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function parseArgs(raw) {
  if (raw && typeof raw === "object") return raw;
  if (typeof raw !== "string") return {};
  try {
    return toRecord(JSON.parse(raw));
  } catch {
    return {};
  }
}

function buildCoreBody(providerId, args) {
  const filters = toRecord(args.filters);
  const include = Array.isArray(filters.include_domains) ? filters.include_domains : [];
  const exclude = Array.isArray(filters.exclude_domains) ? filters.exclude_domains : [];
  // 9router's search providers expect the "-domain" prefix convention for exclusions.
  const domainFilter = [...include, ...exclude.map((d) => `-${d}`)];
  return {
    query: typeof args.query === "string" ? args.query.trim() : "",
    provider: providerId,
    max_results: args.max_results,
    search_type: args.search_type,
    country: args.country,
    language: args.language,
    time_range: args.time_range,
    domain_filter: domainFilter.length > 0 ? domainFilter : undefined,
  };
}

// Empty/default settings.webSearchFallbackProvider -> first search-capable provider that
// actually has usable credentials at runtime (noAuth providers count as configured).
async function pickDefaultProvider() {
  for (const [id, def] of Object.entries(AI_PROVIDERS)) {
    if (!def || (!def.searchConfig && !def.searchViaChat)) continue;
    if (def.noAuth) return id;
    const creds = await getProviderCredentials(id, new Set(), `websearch:${id}`);
    if (creds && !creds.allRateLimited) return id;
  }
  return null;
}

// Credential + account-fallback loop, adapted from src/sse/handlers/search.js.
// handleSearchCore ignores the two callbacks below (refresh happens via the explicit
// checkAndRefreshToken call); they are passed for parity with the upstream handler.
async function runSingleSearch(providerInput, args, log) {
  const providerId = resolveProviderId(providerInput);
  const resolvedProvider = AI_PROVIDERS[providerId];
  if (!resolvedProvider) return { success: false, error: `Unknown provider: ${providerInput}` };
  const providerConfig = resolvedProvider.searchConfig;
  if (!providerConfig && !resolvedProvider.searchViaChat) {
    return { success: false, error: `Provider ${providerId} does not support web search` };
  }

  const coreBody = buildCoreBody(providerId, args);
  if (!coreBody.query) return { success: false, error: "Missing search query" };

  if (resolvedProvider.noAuth) {
    const result = await handleSearchCore({
      body: coreBody,
      provider: resolvedProvider,
      providerConfig,
      credentials: null,
      log,
    });
    return result.success ? { success: true, data: result.data } : { success: false, error: result.error };
  }

  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;
  const fallbackProviderId = resolvedProvider.credentialFallback;
  const searchLockKey = `websearch:${providerId}`;

  while (true) {
    let credentialProviderId = providerId;
    let credentials = await getProviderCredentials(providerId, excludeConnectionIds, searchLockKey);
    if (!credentials && fallbackProviderId) {
      credentials = await getProviderCredentials(fallbackProviderId, excludeConnectionIds, searchLockKey);
      if (credentials) credentialProviderId = fallbackProviderId;
    }

    if (!credentials || credentials.allRateLimited) {
      const detail = credentials?.allRateLimited
        ? lastError || credentials.lastError || "All accounts unavailable"
        : excludeConnectionIds.size === 0
          ? `No credentials for provider: ${providerId}`
          : lastError || "All accounts unavailable";
      return { success: false, error: `[${providerId}] ${detail}` };
    }

    const refreshedCredentials = await checkAndRefreshToken(providerId, credentials);
    const result = await handleSearchCore({
      body: coreBody,
      provider: resolvedProvider,
      providerConfig,
      credentials: refreshedCredentials,
      log,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          accessToken: newCreds.accessToken,
          refreshToken: newCreds.refreshToken,
          providerSpecificData: newCreds.providerSpecificData,
          testStatus: "active",
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials);
      },
    });

    if (result.success) return { success: true, data: result.data };

    const { shouldFallback } = await markAccountUnavailable(
      credentials.connectionId,
      result.status,
      result.error,
      credentialProviderId,
      searchLockKey,
    );
    if (shouldFallback) {
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }
    return { success: false, error: result.error || `[${providerId}] Search failed (${lastStatus || result.status || 503})` };
  }
}

// providerInput may be a combo name: try each member in order, first success wins.
// ponytail: sequential combo trial (fallback strategy only); handleComboChat is overkill here.
async function executeWebSearch(args, log) {
  const settings = await getSettings();
  let providerInput = typeof settings.webSearchFallbackProvider === "string"
    ? settings.webSearchFallbackProvider.trim()
    : "";
  if (!providerInput) {
    providerInput = await pickDefaultProvider();
    if (!providerInput) {
      return { success: false, error: "No search-capable provider configured (set webSearchFallbackProvider)" };
    }
  }

  const combos = await getCombos();
  const comboModels = getComboModelsFromData(providerInput, combos);
  if (Array.isArray(comboModels) && comboModels.length > 0) {
    let lastError = null;
    for (const model of comboModels) {
      const outcome = await runSingleSearch(model, args, log);
      if (outcome.success) return outcome;
      lastError = outcome.error;
    }
    return { success: false, error: lastError || "All combo providers failed" };
  }

  return runSingleSearch(providerInput, args, log);
}

function extractHandledCalls(response, sourceFormat, toolName) {
  const calls = [];
  if (sourceFormat === FORMATS.CLAUDE) {
    for (const block of Array.isArray(response.content) ? response.content : []) {
      if (block?.type === CLAUDE_BLOCK.TOOL_USE && block.name === toolName) {
        calls.push({ id: block.id, args: toRecord(block.input) });
      }
    }
  } else if (sourceFormat === FORMATS.OPENAI_RESPONSES) {
    for (const item of Array.isArray(response.output) ? response.output : []) {
      if (item?.type === RESPONSES_ITEM.FUNCTION_CALL && item.name === toolName) {
        calls.push({ id: item.call_id, args: parseArgs(item.arguments) });
      }
    }
  } else {
    const message = toRecord(toRecord(response.choices?.[0]).message);
    const toolCalls = Array.isArray(response.tool_calls) ? response.tool_calls : message.tool_calls;
    for (const call of Array.isArray(toolCalls) ? toolCalls : []) {
      if (call?.function?.name === toolName) {
        calls.push({ id: call.id, args: parseArgs(call.function.arguments) });
      }
    }
  }
  return calls;
}

function resultPayload(outcome) {
  if (!outcome.success) return { success: false, error: outcome.error };
  const data = toRecord(outcome.data);
  return {
    success: true,
    provider: data.provider,
    query: data.query,
    results: Array.isArray(data.results) ? data.results : [],
    answer: data.answer ?? null,
  };
}

// Claude Code renders native search execution as a server_tool_use block followed by a
// web_search_tool_result block, and its "Did N searches" footer counts exactly those blocks
// in the assistant content (XES in the CLI bundle: searchCount = max(server_tool_use,
// web_search_tool_result) and results carry {title,url} per hit). We served the search
// locally, so emit the same pair. Ids use the srvtoolu_ prefix the Anthropic validator
// expects and the tool name stays "web_search", so the claude.js history round-trip keeps
// the blocks instead of dropping them. The text block is kept for non-claude upstreams that
// lose these blocks in translation (and it is how results reached the model before).
function searchBlocks(toolName, call, payload) {
  const id = `srvtoolu_${String(call.id).replace(/[^a-zA-Z0-9_]/g, "_")}`;
  return [
    { type: CLAUDE_BLOCK.SERVER_TOOL_USE, id, name: "web_search", input: call.args },
    {
      type: CLAUDE_BLOCK.WEB_SEARCH_TOOL_RESULT,
      tool_use_id: id,
      content: payload.success
        ? payload.results.map((r) => ({ type: "web_search_result", title: r.title, url: r.url }))
        : { error_code: "9router_search_error", error_message: String(payload.error || "Search failed") },
    },
    { type: CLAUDE_BLOCK.TEXT, text: `[Skill result: ${toolName}]\n${JSON.stringify(payload)}` },
  ];
}

// Claude Code also prices searches from usage.server_tool_use.web_search_requests, which
// only Anthropic's own execution sets. Count the searches we served locally so the number
// reflects what actually happened; additive so any upstream count is kept.
function withSearchUsage(usage, count, toolKey, requestKey) {
  const prev = toRecord(usage);
  const prevTool = toRecord(prev[toolKey]);
  return {
    ...prev,
    [toolKey]: { ...prevTool, [requestKey]: (Number(prevTool[requestKey]) || 0) + count },
  };
}

function rewriteClaude(response, toolName, handled, outcomes) {
  const blocksById = new Map(
    handled.map((call, i) => [call.id, searchBlocks(toolName, call, outcomes[i])]),
  );
  const content = [];
  let inserted = false;
  for (const block of response.content) {
    if (block?.type === CLAUDE_BLOCK.TOOL_USE && blocksById.has(block.id)) {
      content.push(...blocksById.get(block.id));
      inserted = true;
      continue;
    }
    // Results must precede any remaining (client-owned) tool_use blocks.
    if (!inserted && block?.type === CLAUDE_BLOCK.TOOL_USE) {
      for (const call of handled) content.push(...blocksById.get(call.id));
      inserted = true;
    }
    content.push(block);
  }
  if (!inserted) {
    for (const call of handled) content.push(...blocksById.get(call.id));
  }
  const hasRemainingToolUse = content.some((b) => b?.type === CLAUDE_BLOCK.TOOL_USE);
  return {
    ...response,
    content,
    usage: withSearchUsage(response.usage, handled.length, "server_tool_use", "web_search_requests"),
    ...(hasRemainingToolUse ? {} : { stop_reason: CLAUDE_STOP.END_TURN, stop_sequence: null }),
  };
}

function rewriteResponses(response, handled, outcomes) {
  const output = Array.isArray(response.output) ? [...response.output] : [];
  handled.forEach((call, i) => {
    const payload = outcomes[i];
    output.push({
      type: RESPONSES_ITEM.FUNCTION_CALL_OUTPUT,
      call_id: call.id,
      output: JSON.stringify(payload),
    });
    if (payload.success) {
      output.push({
        id: `ws_${call.id}`,
        type: "web_search_call",
        status: "completed",
        action: {
          type: "web_search",
          query: payload.query,
          sources: payload.results.map((r) => ({ title: r.title, url: r.url, caption: r.snippet })),
        },
      });
    }
  });
  return { ...response, output };
}

function rewriteChat(response, handled, outcomes) {
  // Keep tool_calls/finish_reason as-is; expose results out-of-band like the OmniRoute
  // escape hatch so the client reads them without a follow-up turn.
  return {
    ...response,
    tool_results: handled.map((call, i) => ({
      tool_call_id: call.id,
      output: JSON.stringify(outcomes[i]),
    })),
  };
}

export async function applyWebSearchFallback({ translatedResponse, sourceFormat, fallbackPlan, log }) {
  if (!fallbackPlan?.enabled || !translatedResponse || typeof translatedResponse !== "object") {
    return translatedResponse;
  }
  try {
    const toolName = fallbackPlan.toolName;
    const handled = extractHandledCalls(translatedResponse, sourceFormat, toolName);
    if (handled.length === 0) return translatedResponse;

    log?.debug?.("WEBSEARCH", `Intercepting ${handled.length} ${toolName} call(s)`);
    const outcomes = [];
    for (const call of handled) {
      try {
        outcomes.push(resultPayload(await executeWebSearch(call.args, log)));
      } catch (err) {
        outcomes.push({ success: false, error: err?.message || "Search execution failed" });
      }
    }

    if (sourceFormat === FORMATS.CLAUDE && Array.isArray(translatedResponse.content)) {
      return rewriteClaude(translatedResponse, toolName, handled, outcomes);
    }
    if (sourceFormat === FORMATS.OPENAI_RESPONSES) {
      return rewriteResponses(translatedResponse, handled, outcomes);
    }
    return rewriteChat(translatedResponse, handled, outcomes);
  } catch (err) {
    // Fail-open: a broken intercept must never take down the chat response.
    log?.warn?.("WEBSEARCH", `Intercept failed, passing response through: ${err?.message}`);
    return translatedResponse;
  }
}
