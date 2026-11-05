/**
 * Convert OpenAI Responses events into Claude message events.
 *
 * The existing Responses-to-Chat and Chat-to-Claude converters handle answer text,
 * reasoning, and client tools. This direct route also collects hosted-search actions
 * and citations, then emits the search blocks Claude Code needs to display sources.
 * Streaming and JSON conversion share the evidence builder in concerns/search.js.
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { CLAUDE_BLOCK, RESPONSES_ITEM } from "../schema/index.js";
import { buildSearchEvidence, collectSearchItem, countSearches, withSearchUsage } from "../concerns/search.js";
import { openAICompletionToClaudeMessage } from "../concerns/claudeMessage.js";
import { openaiResponsesToOpenAIResponse } from "./openai-responses.js";
import { openaiToClaudeResponse } from "./openai-to-claude.js";

// Close answer content before inserting standalone search blocks into its index sequence.
function closeContent(state, events) {
  if (state.thinkingBlockStarted) {
    events.push({
      type: "content_block_stop",
      index: state.thinkingBlockIndex
    });
    state.thinkingBlockStarted = false;
  }
  if (state.textBlockStarted) {
    events.push({
      type: "content_block_stop",
      index: state.textBlockIndex
    });
    state.textBlockStarted = false;
    state.textBlockClosed = true;
  }
}

// Emit one complete Claude block. Tool accumulators read input from JSON deltas,
// so server-tool input cannot appear only in the opening block.
function emitBlock(block, state, events) {
  const index = state.nextBlockIndex++;

  if (block.type === CLAUDE_BLOCK.SERVER_TOOL_USE) {
    events.push({
      type: "content_block_start",
      index,
      content_block: { ...block, input: {} }
    });
    events.push({
      type: "content_block_delta",
      index,
      delta: {
        type: "input_json_delta",
        partial_json: JSON.stringify(block.input)
      }
    });
  } else {
    events.push({
      type: "content_block_start",
      index,
      content_block: block
    });
  }

  events.push({ type: "content_block_stop", index });
}

// Preserve the upstream failure message, including failures wrapped in response.done.
function failureEvent(data) {
  const message = data?.response?.error?.message ||
    data?.error?.message ||
    data?.message ||
    "Upstream Responses request did not complete";

  return [{
    type: "error",
    error: { type: "api_error", message }
  }];
}

// A terminal event name does not imply success: response.done can carry a failed status.
function terminalStatus(data) {
  if (["response.completed", "response.done"].includes(data?.type)) {
    return data.response?.status || "completed";
  }
  if (data?.type === "response.incomplete") {
    return "incomplete";
  }
  if (["response.failed", "error"].includes(data?.type)) {
    return "failed";
  }
  return null;
}

// Collect evidence from incremental events and final output. Shared maps deduplicate
// repeated actions and retain final sources that the incremental events did not expose.
function collectEvent(data, state) {
  if (data?.item?.type === RESPONSES_ITEM.WEB_SEARCH_CALL) {
    state.hostedSearchObserved = true;
  }
  if (["response.completed", "response.done"].includes(data?.type)) {
    state.responsesCompleted = !data.response?.status || data.response.status === "completed";
    for (const item of data.response?.output || []) {
      collectSearchItem(item, state.hostedSearches, state.searchCitations);
    }
  }
  if (data?.type === "response.output_item.done") {
    collectSearchItem(data.item, state.hostedSearches, state.searchCitations);
  }
  if (data?.annotation?.type === "url_citation" && data.annotation.url) {
    state.searchCitations.set(data.annotation.url, data.annotation);
  }
}

// Select actions not yet sent to the client; do not rebuild previously emitted blocks.
function pendingSearches(state) {
  const pending = new Map();
  for (const [id, search] of state.hostedSearches) {
    if (!state.emittedSearches.has(id)) {
      pending.set(id, search);
    }
  }
  return pending;
}

// Remember delivered result URLs so final citation supplements contain only missing sources.
function recordSources(block, state) {
  if (block.type !== CLAUDE_BLOCK.WEB_SEARCH_TOOL_RESULT || !Array.isArray(block.content)) {
    return;
  }
  for (const result of block.content) {
    state.emittedSources.add(result.url);
  }
}

// Sources may arrive after their search block was sent. Return them as answer-source
// text at completion instead of losing them or emitting the same search twice.
function emitLateCitations(state, events) {
  const missing = new Map();
  for (const search of state.hostedSearches.values()) {
    for (const source of search.action?.sources || []) {
      if (source.url && !state.emittedSources.has(source.url)) {
        missing.set(source.url, source);
      }
    }
  }
  for (const [url, citation] of state.searchCitations) {
    if (!state.emittedSources.has(url)) {
      missing.set(url, citation);
    }
  }

  const evidence = buildSearchEvidence(new Map(), missing);
  for (const block of evidence.supplements) {
    emitBlock(block, state, events);
  }
}

// Emit pending action blocks now and missing citations at completion. Citation fallback
// is safe only when the entire response contains one action, not merely one pending action.
function emitSearchResults(state, terminal) {
  const events = [];
  let citations = state.searchCitations;
  if (state.hostedSearches.size !== 1) {
    citations = new Map();
  }

  const evidence = buildSearchEvidence(pendingSearches(state), citations);
  for (const [id, blocks] of evidence.actions) {
    for (const block of blocks) {
      emitBlock(block, state, events);
      recordSources(block, state);
    }
    state.emittedSearches.add(id);
  }
  if (terminal && !state.searchSupplementsSent) {
    emitLateCitations(state, events);
    state.searchSupplementsSent = true;
  }
  return events;
}

// Let the ordinary converter close client tools first. Insert remaining evidence
// before message_delta/message_stop, then attach the observed search count to usage.
function finishEvents(intermediate, state) {
  const translated = openaiToClaudeResponse(intermediate, state) || [];
  const terminalIndex = translated.findIndex(event => event.type === "message_delta");
  if (terminalIndex < 0) {
    return translated;
  }

  const evidence = emitSearchResults(state, true);
  translated.splice(terminalIndex, 0, ...evidence);
  state.usage = withSearchUsage(state.usage, countSearches(state.hostedSearches));
  for (const event of translated) {
    if (event.type === "message_delta") {
      event.usage = state.usage;
    }
  }
  return translated;
}

// A non-search output limit is a partial answer, not an API failure. Convert terminal
// usage through the existing Responses converter before setting Claude's max_tokens stop.
function finishTokenLimitedResponse(data, state) {
  state.responsesCompleted = true;
  const completion = openaiResponsesToOpenAIResponse({
    type: "response.completed",
    response: data.response
  }, state.responsesBridge);
  if (!completion) {
    return null;
  }

  completion.choices[0].finish_reason = "length";
  return openaiToClaudeResponse(completion, state);
}

/**
 * Convert one upstream event, or flush on a null chunk.
 * The Responses converter owns separate state from Claude block/index tracking.
 * Search-enabled streams must receive a successful terminal event before ending.
 */
export function responsesToClaudeResponse(chunk, state) {
  state.responsesBridge ??= { toolCalls: new Map(), model: state.model };
  state.hostedSearches ??= new Map();
  state.searchCitations ??= new Map();
  state.emittedSearches ??= new Set();
  state.emittedSources ??= new Set();
  if (state.searchBridgeFailed) {
    return null;
  }

  // Validate completion before a generic flush can manufacture a successful finish.
  const data = chunk?.data || chunk;
  const requiresCompletion = state.searchEnabled || state.hostedSearchObserved;
  const truncated = !chunk && requiresCompletion && !state.responsesCompleted;
  const status = terminalStatus(data);
  const outputLimitReached = data?.response?.incomplete_details?.reason === "max_output_tokens";
  if (status === "incomplete" && !requiresCompletion && outputLimitReached) {
    return finishTokenLimitedResponse(data, state);
  }
  const invalidTerminal = status !== null && status !== "completed";
  if (truncated || invalidTerminal) {
    state.searchBridgeFailed = true;
    return failureEvent(data);
  }

  // Emit completed searches before later text/tools when no client tool is open.
  // Otherwise, finishEvents inserts them after the client tool has closed.
  collectEvent(data, state);
  const completedSearch = data?.type === "response.output_item.done" &&
    data.item?.type === RESPONSES_ITEM.WEB_SEARCH_CALL;
  if (completedSearch && state.toolCalls.size === 0) {
    const openingChunk = {
      model: state.model,
      choices: [{ delta: {} }]
    };
    const events = openaiToClaudeResponse(openingChunk, state) || [];
    closeContent(state, events);
    return [...events, ...emitSearchResults(state, false)];
  }

  // Delegate ordinary content; completion gets the final search evidence and usage.
  const intermediate = openaiResponsesToOpenAIResponse(chunk, state.responsesBridge);
  if (!intermediate) {
    return null;
  }
  if (intermediate.choices?.[0]?.finish_reason) {
    return finishEvents(intermediate, state);
  }
  return openaiToClaudeResponse(intermediate, state);
}

// Convert each output item once while the JSON caller walks the original item order.
function ordinaryItemBlocks(item) {
  if (item.type === RESPONSES_ITEM.MESSAGE) {
    const blocks = [];
    for (const part of item.content || []) {
      if (part.type === RESPONSES_ITEM.OUTPUT_TEXT) {
        blocks.push({ type: CLAUDE_BLOCK.TEXT, text: part.text });
      }
    }
    return blocks;
  }
  if (item.type === RESPONSES_ITEM.FUNCTION_CALL) {
    const toolCall = {
      id: item.call_id,
      function: {
        name: item.name,
        arguments: item.arguments
      }
    };
    const completion = {
      choices: [{
        message: { tool_calls: [toolCall] },
        finish_reason: "tool_calls"
      }]
    };
    return openAICompletionToClaudeMessage(completion).content;
  }
  return [];
}

/**
 * Enrich a converted JSON message with ordered Responses content and search evidence.
 * First collect metadata for citation attribution, then walk items in their original
 * order. Ordinary non-search responses retain the caller's existing conversion.
 */
export function responsesSearchToClaudeMessage(response, message, searchEnabled = false) {
  const searches = new Map();
  const citations = new Map();
  for (const item of response.output || []) {
    collectSearchItem(item, searches, citations);
  }
  if (!searchEnabled && searches.size === 0 && citations.size === 0) {
    return message;
  }

  const evidence = buildSearchEvidence(searches, citations);
  const content = [];
  const emitted = new Set();
  for (const item of response.output || []) {
    if (item.type === RESPONSES_ITEM.WEB_SEARCH_CALL) {
      if (!emitted.has(item.id)) {
        const actionBlocks = evidence.actions.get(item.id) || [];
        content.push(...actionBlocks);
        emitted.add(item.id);
      }
    } else {
      content.push(...ordinaryItemBlocks(item));
    }
  }
  content.push(...evidence.supplements);

  return {
    ...message,
    content,
    usage: withSearchUsage(message.usage, countSearches(searches))
  };
}

register(FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE, null, responsesToClaudeResponse);
