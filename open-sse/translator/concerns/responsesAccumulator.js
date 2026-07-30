const TERMINAL_EVENT_STATUS = {
  "response.completed": "completed",
  "response.done": "completed",
  "response.incomplete": "incomplete",
  "response.failed": "failed",
  "response.error": "failed",
  error: "failed"
};

const TOOL_ITEM_TYPES = new Set(["function_call", "custom_tool_call"]);

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function eventPayload(event) {
  if (!event || typeof event !== "object") return { type: null, data: null };
  const data = event.data && typeof event.data === "object" ? event.data : event;
  return { type: data.type || event.type || event.event || null, data };
}

function numberOrNull(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function preferComplete(current, incoming) {
  if (typeof incoming !== "string" || incoming === "") return current || "";
  if (!current || incoming.startsWith(current)) return incoming;
  if (current.startsWith(incoming)) return current;
  return incoming;
}

function itemIdentifiers(data) {
  const item = data?.item;
  return {
    outputIndex: numberOrNull(data?.output_index),
    itemId: data?.item_id || item?.id || null,
    callId: data?.call_id || item?.call_id || null
  };
}

function newItem(state, type = null) {
  const order = state.nextItemOrder++;
  const item = {
    order,
    aliasOrders: new Set([order]),
    outputIndex: null,
    id: null,
    callId: null,
    type,
    name: "",
    role: null,
    status: null,
    arguments: "",
    input: "",
    argumentFragments: [],
    inputFragments: [],
    argumentsSnapshot: "",
    inputSnapshot: "",
    content: new Map(),
    summary: new Map(),
    contentFragments: new Map(),
    summaryFragments: new Map(),
    contentSnapshots: new Map(),
    summarySnapshots: new Map(),
    raw: {}
  };
  state.items.push(item);
  return item;
}

function mergePart(target, incoming, fallbackType) {
  if (!incoming || typeof incoming !== "object") return target;
  const merged = { ...(target || {}), ...clone(incoming) };
  if (fallbackType && !merged.type) merged.type = fallbackType;
  if (typeof incoming.text === "string") {
    merged.text = preferComplete(target?.text, incoming.text);
  }
  return merged;
}

function remapItem(state, from, to) {
  for (const [key, value] of state.itemsByOutputIndex) {
    if (value === from) state.itemsByOutputIndex.set(key, to);
  }
  for (const [key, value] of state.itemsById) {
    if (value === from) state.itemsById.set(key, to);
  }
  for (const [key, value] of state.itemsByCallId) {
    if (value === from) state.itemsByCallId.set(key, to);
  }
  for (const [key, value] of state.implicitItemsByType) {
    if (value === from) state.implicitItemsByType.set(key, to);
  }
}

function mergeFragments(target, source, snapshotKey, fragmentsKey, valueKey) {
  target[fragmentsKey].push(...source[fragmentsKey]);
  target[fragmentsKey].sort((a, b) => a.order - b.order);
  target[snapshotKey] = preferComplete(target[snapshotKey], source[snapshotKey]);
  const deltas = target[fragmentsKey].map(fragment => fragment.value).join("");
  target[valueKey] = preferComplete(deltas, target[snapshotKey]);
}

function recomputePart(item, collectionKey, fragmentsKey, snapshotsKey, index, fallbackType) {
  const fragments = item[fragmentsKey].get(index) || [];
  fragments.sort((a, b) => a.order - b.order);
  const deltaText = fragments.map(fragment => fragment.value).join("");
  const snapshot = item[snapshotsKey].get(index);
  const current = mergePart(item[collectionKey].get(index), snapshot, fallbackType) || { type: fallbackType };
  current.text = preferComplete(deltaText, snapshot?.text);
  item[collectionKey].set(index, current);
}

function mergePartState(target, source, collectionKey, fragmentsKey, snapshotsKey, fallbackType) {
  const indices = new Set([
    ...target[collectionKey].keys(),
    ...source[collectionKey].keys(),
    ...target[fragmentsKey].keys(),
    ...source[fragmentsKey].keys(),
    ...target[snapshotsKey].keys(),
    ...source[snapshotsKey].keys()
  ]);
  for (const [index, fragments] of source[fragmentsKey]) {
    const targetFragments = target[fragmentsKey].get(index) || [];
    targetFragments.push(...fragments);
    target[fragmentsKey].set(index, targetFragments);
  }
  for (const [index, snapshot] of source[snapshotsKey]) {
    target[snapshotsKey].set(index, mergePart(target[snapshotsKey].get(index), snapshot, fallbackType));
  }
  for (const index of indices) {
    recomputePart(target, collectionKey, fragmentsKey, snapshotsKey, index, fallbackType);
  }
}

function mergeItems(state, target, source) {
  if (!source || source === target) return target;
  target.outputIndex ??= source.outputIndex;
  target.id ||= source.id;
  target.callId ||= source.callId;
  target.type ||= source.type;
  target.name ||= source.name;
  target.role ||= source.role;
  target.status ||= source.status;
  for (const order of source.aliasOrders) target.aliasOrders.add(order);
  mergeFragments(target, source, "argumentsSnapshot", "argumentFragments", "arguments");
  mergeFragments(target, source, "inputSnapshot", "inputFragments", "input");
  target.raw = { ...source.raw, ...target.raw };
  mergePartState(target, source, "content", "contentFragments", "contentSnapshots", "output_text");
  mergePartState(target, source, "summary", "summaryFragments", "summarySnapshots", "summary_text");
  remapItem(state, source, target);
  state.items = state.items.filter(item => item !== source);
  return target;
}

function ensureItem(state, data, typeHint = null) {
  const ids = itemIdentifiers(data);
  const candidates = [];
  const identityCandidates = [];
  const addCandidate = item => {
    if (item && !candidates.includes(item)) candidates.push(item);
  };
  const addIdentityCandidate = item => {
    if (item && !identityCandidates.includes(item)) identityCandidates.push(item);
  };
  if (ids.itemId) {
    addIdentityCandidate(state.itemsById.get(ids.itemId));
    addIdentityCandidate(state.itemsByCallId.get(ids.itemId));
  }
  if (ids.callId) {
    addIdentityCandidate(state.itemsByCallId.get(ids.callId));
    addIdentityCandidate(state.itemsById.get(ids.callId));
  }
  const indexedCandidate = ids.outputIndex !== null
    ? state.itemsByOutputIndex.get(ids.outputIndex)
    : null;
  const indexConflict = indexedCandidate && (
    (ids.itemId && indexedCandidate.id && ids.itemId !== indexedCandidate.id) ||
    (ids.callId && indexedCandidate.callId && ids.callId !== indexedCandidate.callId)
  );
  if (indexConflict) {
    state.outputOrderConflict = true;
  } else {
    addCandidate(indexedCandidate);
  }
  for (const identityCandidate of identityCandidates) addCandidate(identityCandidate);
  const hasIdentity = ids.outputIndex !== null || ids.itemId || ids.callId;
  if (candidates.length === 0 && typeHint && !hasIdentity) {
    addCandidate(state.implicitItemsByType.get(typeHint));
  }

  let item = candidates[0] || newItem(state, typeHint);
  for (let i = 1; i < candidates.length; i++) item = mergeItems(state, item, candidates[i]);

  if (ids.outputIndex !== null) {
    item.outputIndex ??= ids.outputIndex;
    state.itemsByOutputIndex.set(ids.outputIndex, item);
  }
  if (ids.itemId) {
    item.id ||= ids.itemId;
    state.itemsById.set(ids.itemId, item);
  }
  if (ids.callId) {
    item.callId ||= ids.callId;
    state.itemsByCallId.set(ids.callId, item);
  }
  item.type ||= typeHint;
  if (typeHint) state.implicitItemsByType.set(typeHint, item);
  return item;
}

function ingestItemSnapshot(state, rawItem, outputIndex = null, envelope = null, positionalIndex = false) {
  if (!rawItem || typeof rawItem !== "object") return null;
  const itemId = envelope?.item_id || rawItem.id;
  const callId = envelope?.call_id || rawItem.call_id;
  const knownItem = (itemId && (state.itemsById.get(itemId) || state.itemsByCallId.get(itemId))) ||
    (callId && (state.itemsByCallId.get(callId) || state.itemsById.get(callId))) || null;
  const suppliedOutputIndex = numberOrNull(outputIndex);
  const data = {
    output_index: positionalIndex
      ? knownItem?.outputIndex ?? suppliedOutputIndex
      : suppliedOutputIndex,
    item_id: itemId,
    call_id: callId,
    item: rawItem
  };
  const item = ensureItem(state, data, rawItem.type || null);
  const { content, summary, arguments: args, input, ...raw } = clone(rawItem);
  item.raw = { ...item.raw, ...raw };
  item.type = rawItem.type || item.type;
  item.id = rawItem.id || item.id;
  item.callId = rawItem.call_id || item.callId;
  item.name = rawItem.name || item.name;
  item.role = rawItem.role || item.role;
  item.status = rawItem.status || item.status;

  if (Array.isArray(content)) {
    content.forEach((part, index) => {
      applyPartSnapshot(item, item.content, item.contentFragments, item.contentSnapshots, index, part, "output_text");
    });
  } else if (typeof content === "string") {
    applyPartSnapshot(item, item.content, item.contentFragments, item.contentSnapshots, 0, { type: "output_text", text: content }, "output_text");
  }
  if (Array.isArray(summary)) {
    summary.forEach((part, index) => {
      applyPartSnapshot(item, item.summary, item.summaryFragments, item.summarySnapshots, index, part, "summary_text");
    });
  }
  if (typeof args === "string" && args) {
    item.argumentsSnapshot = preferComplete(item.argumentsSnapshot, args);
    item.arguments = preferComplete(item.arguments, item.argumentsSnapshot);
  }
  if (typeof input === "string" && input) {
    item.inputSnapshot = preferComplete(item.inputSnapshot, input);
    item.input = preferComplete(item.input, item.inputSnapshot);
  }
  return item;
}

function applyResponseMetadata(state, response) {
  if (!response || typeof response !== "object") return;
  if (response.id) state.id = response.id;
  if (response.object) state.object = response.object;
  if (response.created_at) state.createdAt = response.created_at;
  if (response.model) state.model = response.model;
  if (response.usage && typeof response.usage === "object") {
    state.usage = mergeUsage(state.usage, response.usage);
  }
  if (Array.isArray(response.output)) {
    response.output.forEach((item, index) => ingestItemSnapshot(state, item, index, null, true));
  }
}

function mergeUsage(current, incoming) {
  const merged = { ...(clone(current) || {}) };
  for (const [key, value] of Object.entries(incoming || {})) {
    if (value === undefined || value === null) continue;
    if (typeof value === "object" && !Array.isArray(value)) {
      merged[key] = { ...(merged[key] || {}), ...clone(value) };
    } else {
      merged[key] = value;
    }
  }
  if (typeof merged.input_tokens === "number" && typeof merged.output_tokens === "number" &&
      incoming.total_tokens === undefined) {
    merged.total_tokens = merged.input_tokens + merged.output_tokens;
  }
  return merged;
}

function applyPartSnapshot(item, collection, fragments, snapshots, index, incoming, fallbackType) {
  snapshots.set(index, mergePart(snapshots.get(index), incoming, fallbackType));
  const deltaText = (fragments.get(index) || []).sort((a, b) => a.order - b.order)
    .map(fragment => fragment.value).join("");
  const snapshot = snapshots.get(index);
  const current = mergePart(collection.get(index), snapshot, fallbackType) || { type: fallbackType };
  current.text = preferComplete(deltaText, snapshot?.text);
  collection.set(index, current);
}

function applyContentPart(item, collection, fragments, snapshots, data, fallbackType) {
  const index = numberOrNull(data.content_index ?? data.summary_index) ?? 0;
  const incoming = data.part || { type: fallbackType, text: data.text };
  applyPartSnapshot(item, collection, fragments, snapshots, index, incoming, fallbackType);
  return item;
}

function applyDelta(state, item, collection, fragments, snapshots, data, fallbackType) {
  const index = numberOrNull(data.content_index ?? data.summary_index) ?? 0;
  if (typeof data.delta !== "string" || !data.delta) return item;
  const partFragments = fragments.get(index) || [];
  partFragments.push({ order: state.nextDeltaOrder++, value: data.delta });
  fragments.set(index, partFragments);
  const deltaText = partFragments.sort((a, b) => a.order - b.order).map(fragment => fragment.value).join("");
  const snapshot = snapshots.get(index);
  const current = mergePart(collection.get(index), snapshot, fallbackType) || { type: fallbackType };
  current.text = preferComplete(deltaText, snapshot?.text);
  collection.set(index, current);
  return item;
}

function sortedItems(state) {
  return [...state.items].sort((a, b) => {
    if (a.outputIndex !== null && b.outputIndex !== null) return a.outputIndex - b.outputIndex;
    if (a.outputIndex !== null) return -1;
    if (b.outputIndex !== null) return 1;
    return a.order - b.order;
  });
}

function sortedParts(parts) {
  return [...parts.entries()].sort((a, b) => a[0] - b[0]).map(([, part]) => clone(part));
}

function fallbackToolId(item) {
  if (item.id) return item.id;
  if (item.callId) return `fc_${item.callId}`;
  if (item.outputIndex !== null) return `fc_output_${item.outputIndex}`;
  return `fc_${item.order}`;
}

function buildItem(item, terminalStatus = null) {
  const output = clone(item.raw) || {};
  if (item.type) output.type = item.type;
  if (item.id || TOOL_ITEM_TYPES.has(item.type)) output.id = item.id || fallbackToolId(item);
  if (item.role) output.role = item.role;
  if (item.status) output.status = item.status;
  if (terminalStatus && (!output.status || output.status === "in_progress")) {
    output.status = terminalStatus === "completed" ? "completed" : "incomplete";
  }

  if (item.type === "message") {
    output.role ||= "assistant";
    output.content = sortedParts(item.content);
  } else if (item.type === "reasoning") {
    output.summary = sortedParts(item.summary);
    if (item.content.size > 0) output.content = sortedParts(item.content);
  } else if (item.type === "function_call") {
    item.callId ||= output.call_id || item.id || `call_output_${item.outputIndex ?? item.order}`;
    output.call_id = item.callId;
    output.name = item.name || output.name || "";
    output.arguments = item.arguments || output.arguments || "";
  } else if (item.type === "custom_tool_call") {
    item.callId ||= output.call_id || item.id || `call_output_${item.outputIndex ?? item.order}`;
    output.call_id = item.callId;
    output.name = item.name || output.name || "";
    output.input = item.input || output.input || "";
  }
  return output;
}

export function createResponsesAccumulator({ id = "", createdAt = 0, model = "" } = {}) {
  return {
    id,
    object: "response",
    createdAt,
    model,
    usage: null,
    items: [],
    itemsByOutputIndex: new Map(),
    itemsById: new Map(),
    itemsByCallId: new Map(),
    implicitItemsByType: new Map(),
    nextItemOrder: 0,
    nextDeltaOrder: 0,
    outputOrderConflict: false,
    sawEvent: false,
    finalized: false,
    terminalType: null,
    terminalResponse: null,
    doneSent: false
  };
}

export function buildResponsesOutput(state, terminalStatus = null) {
  if (!state) return [];
  return sortedItems(state).map(item => buildItem(item, terminalStatus));
}

export function getResponsesItems(state, type = null) {
  const items = sortedItems(state);
  return type ? items.filter(item => item.type === type) : items;
}

export function responsesItemText(item) {
  if (!item) return "";
  const parts = item.type === "reasoning" ? item.summary : item.content;
  return sortedParts(parts).map(part => typeof part.text === "string" ? part.text : "").join("");
}

export function finalizeResponsesAccumulator(state, {
  eventType = "response.failed",
  response = null,
  status = null,
  error = null,
  incompleteDetails = null
} = {}) {
  if (!state || state.finalized) {
    return { accepted: false, type: state?.terminalType || eventType, response: state?.terminalResponse || null };
  }

  applyResponseMetadata(state, response);
  const terminalStatus = status || response?.status || TERMINAL_EVENT_STATUS[eventType] || "failed";
  const finalResponse = {
    ...(clone(response) || {}),
    id: response?.id || state.id || `resp_${Date.now()}`,
    object: response?.object || state.object || "response",
    created_at: response?.created_at || state.createdAt || Math.floor(Date.now() / 1000),
    status: terminalStatus,
    output: buildResponsesOutput(state, terminalStatus)
  };
  if (state.model && !finalResponse.model) finalResponse.model = state.model;
  if (state.usage) finalResponse.usage = clone(state.usage);
  if (error && !finalResponse.error) finalResponse.error = clone(error);
  if (terminalStatus === "failed" && !finalResponse.error) {
    finalResponse.error = {
      type: "server_error",
      code: "response_failed",
      message: "response failed without error details"
    };
  }
  if (incompleteDetails && !finalResponse.incomplete_details) {
    finalResponse.incomplete_details = clone(incompleteDetails);
  }

  state.finalized = true;
  state.terminalType = eventType;
  state.terminalResponse = finalResponse;
  return { accepted: true, type: eventType, response: finalResponse };
}

export function reduceResponsesEvent(state, event) {
  const { type, data } = eventPayload(event);
  if (!state || !type || !data) return { accepted: false, type, data };
  if (state.finalized) return { accepted: false, type, data, response: state.terminalResponse };

  state.sawEvent = true;
  if (data.response) applyResponseMetadata(state, data.response);
  let item = null;

  switch (type) {
    case "response.output_item.added":
    case "response.output_item.done":
      item = ingestItemSnapshot(state, data.item, data.output_index, data);
      break;
    case "response.content_part.added":
    case "response.content_part.done":
      item = ensureItem(state, data, "message");
      applyContentPart(item, item.content, item.contentFragments, item.contentSnapshots, data, "output_text");
      break;
    case "response.output_text.delta":
      item = ensureItem(state, data, "message");
      applyDelta(state, item, item.content, item.contentFragments, item.contentSnapshots, data, "output_text");
      break;
    case "response.output_text.done":
      item = ensureItem(state, data, "message");
      applyContentPart(item, item.content, item.contentFragments, item.contentSnapshots, data, "output_text");
      break;
    case "response.reasoning_summary_part.added":
    case "response.reasoning_summary_part.done":
      item = ensureItem(state, data, "reasoning");
      applyContentPart(item, item.summary, item.summaryFragments, item.summarySnapshots, data, "summary_text");
      break;
    case "response.reasoning_summary_text.delta":
      item = ensureItem(state, data, "reasoning");
      applyDelta(state, item, item.summary, item.summaryFragments, item.summarySnapshots, data, "summary_text");
      break;
    case "response.reasoning_summary_text.done":
      item = ensureItem(state, data, "reasoning");
      applyContentPart(item, item.summary, item.summaryFragments, item.summarySnapshots, data, "summary_text");
      break;
    case "response.reasoning_text.delta":
      item = ensureItem(state, data, "reasoning");
      applyDelta(state, item, item.content, item.contentFragments, item.contentSnapshots, data, "reasoning_text");
      break;
    case "response.reasoning_text.done":
      item = ensureItem(state, data, "reasoning");
      applyContentPart(item, item.content, item.contentFragments, item.contentSnapshots, data, "reasoning_text");
      break;
    case "response.function_call_arguments.delta":
      item = ensureItem(state, data, "function_call");
      if (typeof data.delta === "string" && data.delta) {
        item.argumentFragments.push({ order: state.nextDeltaOrder++, value: data.delta });
        const deltas = item.argumentFragments.map(fragment => fragment.value).join("");
        item.arguments = preferComplete(deltas, item.argumentsSnapshot);
      }
      break;
    case "response.function_call_arguments.done":
      item = ensureItem(state, data, "function_call");
      if (typeof data.name === "string" && data.name) item.name = data.name;
      item.argumentsSnapshot = preferComplete(item.argumentsSnapshot, data.arguments);
      item.arguments = preferComplete(item.arguments, item.argumentsSnapshot);
      break;
    case "response.custom_tool_call_input.delta":
      item = ensureItem(state, data, "custom_tool_call");
      if (typeof data.delta === "string" && data.delta) {
        item.inputFragments.push({ order: state.nextDeltaOrder++, value: data.delta });
        const deltas = item.inputFragments.map(fragment => fragment.value).join("");
        item.input = preferComplete(deltas, item.inputSnapshot);
      }
      break;
    case "response.custom_tool_call_input.done":
      item = ensureItem(state, data, "custom_tool_call");
      item.inputSnapshot = preferComplete(item.inputSnapshot, data.input);
      item.input = preferComplete(item.input, item.inputSnapshot);
      break;
    default:
      break;
  }

  if (Object.hasOwn(TERMINAL_EVENT_STATUS, type)) {
    const topLevelError = type === "error" ? {
      type: "server_error",
      code: data.code || "response_error",
      message: data.message || "response stream error",
      ...(data.param !== undefined ? { param: data.param } : {})
    } : null;
    const terminal = finalizeResponsesAccumulator(state, {
      eventType: type,
      response: data.response,
      status: type === "response.done"
        ? data.response?.status || TERMINAL_EVENT_STATUS[type]
        : TERMINAL_EVENT_STATUS[type],
      error: data.error || data.response?.error || topLevelError,
      incompleteDetails: data.response?.incomplete_details
    });
    return {
      ...terminal,
      data: terminal.accepted ? { ...clone(data), type, response: terminal.response } : data,
      item
    };
  }

  return { accepted: true, type, data, item };
}
