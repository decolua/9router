/**
 * Convert Codex search actions and sources to the blocks Claude Code reads.
 * Streaming and JSON responses share this conversion; no encrypted payload is fabricated.
 */
import { CLAUDE_BLOCK, OPENAI_BLOCK, RESPONSES_ITEM } from "../schema/index.js";

// Repeated stream events replace the same action or citation instead of duplicating it.
export function collectSearchItem(item, searches, citations) {
  if (item?.type === RESPONSES_ITEM.WEB_SEARCH_CALL && item.id) {
    searches.set(item.id, item);
  }
  for (const part of item?.content || []) {
    for (const citation of part.annotations || []) {
      if (citation.type === "url_citation" && citation.url) {
        citations.set(citation.url, citation);
      }
    }
  }
}

export function countSearches(searches) {
  let count = 0;
  for (const search of searches.values()) {
    if (search.action?.type === "search") {
      count += 1;
    }
  }
  return count;
}

function sourceResults(sources, citations) {
  const results = new Map();
  for (const source of sources) {
    if (!source?.url) {
      continue;
    }
    results.set(source.url, {
      type: CLAUDE_BLOCK.WEB_SEARCH_RESULT,
      url: source.url,
      title: source.title || citations.get(source.url)?.title || source.url
    });
  }
  return [...results.values()];
}

function searchSources(search, searches, citations) {
  if (search.action?.sources?.length) {
    return search.action.sources;
  }
  if (searches.size === 1) {
    return [...citations.values()];
  }
  return [];
}

// Retain all batched queries. Page actions retain their URL/pattern as action evidence.
function actionInput(action) {
  if (action.type !== "search") {
    return { action };
  }
  const queries = action.queries || [];
  const input = { query: action.query || queries.join("; ") };
  if (queries.length > 0) {
    input.queries = queries;
  }
  return input;
}

function actionBlocks(search, searches, citations) {
  const action = search.action || {};
  const results = sourceResults(searchSources(search, searches, citations), citations);
  if (action.type !== "search") {
    return [{
      type: CLAUDE_BLOCK.TEXT,
      text: `Web page operation: ${JSON.stringify(action)}\nSources: ${JSON.stringify(results)}`
    }];
  }
  const toolId = `srvtoolu_${search.id.replace(/[^a-zA-Z0-9_]/g, "_")}`;
  let content = results;
  if (search.status !== "completed") {
    content = { type: CLAUDE_BLOCK.WEB_SEARCH_ERROR, error_code: "unavailable" };
  }
  return [
    { type: CLAUDE_BLOCK.SERVER_TOOL_USE, id: toolId, name: OPENAI_BLOCK.WEB_SEARCH, input: actionInput(action) },
    { type: CLAUDE_BLOCK.WEB_SEARCH_TOOL_RESULT, tool_use_id: toolId, content }
  ];
}

// Build each search pair once. Keep citations without a known search in response-level text.
export function buildSearchEvidence(searches, citations) {
  const actions = new Map();
  const assigned = new Set();
  for (const search of searches.values()) {
    const actionResults = actionBlocks(search, searches, citations);
    actions.set(search.id, actionResults);
    for (const source of searchSources(search, searches, citations)) {
      assigned.add(source.url);
    }
  }
  const lines = [];
  for (const citation of citations.values()) {
    if (!assigned.has(citation.url)) {
      lines.push(`${citation.title || "Source"}: ${citation.url}`);
    }
  }
  const supplements = [];
  if (lines.length > 0) {
    supplements.push({ type: CLAUDE_BLOCK.TEXT, text: `Answer sources:\n${lines.join("\n")}` });
  }
  return { actions, supplements };
}

export function withSearchUsage(usage, count) {
  return {
    ...usage,
    server_tool_use: { ...usage?.server_tool_use, web_search_requests: count }
  };
}
