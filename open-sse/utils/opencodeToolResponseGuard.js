import { OPENCODE_GUARD_LIMITS, OpenCodeUndeclaredToolError } from "./opencodeFingerprint.js";

const encoder = new TextEncoder();

export class OpenCodeToolResponseGuardError extends OpenCodeUndeclaredToolError {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function byteLength(value) {
  return encoder.encode(value).byteLength;
}

function eventSize(event, serializedSize) {
  if (Number.isFinite(serializedSize) && serializedSize >= 0) return serializedSize;
  if (Number.isFinite(event?.serializedSize) && event.serializedSize >= 0) return event.serializedSize;
  return byteLength(typeof event === "string" ? event : "");
}

function isInjected(name, metadata) {
  return metadata?.injectedNames?.has(name) && !metadata?.renameMap?.has(name);
}

function isPotentialInjectedPrefix(name, metadata) {
  const candidates = new Set([
    ...(metadata?.injectedNames || []),
    ...(metadata?.renameMap?.keys() || []),
  ]);
  for (const candidate of candidates) {
    if (candidate !== name && candidate.startsWith(name)) return true;
  }
  return false;
}

function chatToolCalls(payload) {
  const calls = [];
  for (const [choicePosition, choice] of (payload?.choices || []).entries()) {
    const choiceIndex = Number.isInteger(choice?.index) ? choice.index : choicePosition;
    for (const holder of ["delta", "message"]) {
      const toolCalls = choice?.[holder]?.tool_calls;
      if (!Array.isArray(toolCalls)) continue;
      for (const [callPosition, call] of toolCalls.entries()) {
        calls.push({
          choiceIndex,
          choicePosition,
          callIndex: Number.isInteger(call?.index) ? call.index : callPosition,
          callPosition,
          name: call?.function?.name,
          holder,
        });
      }
    }
  }
  return calls;
}

function completeToolCalls(payload) {
  const calls = [];
  const validIndex = (value) => Number.isInteger(value) && value >= 0;
  const add = (format, item, envelopeIndex, position = null) => {
    if (item?.type !== "function_call" && item?.type !== "tool_use") return;
    const id = item.call_id ?? item.id;
    let key;
    if (typeof id === "string" && id.length > 0) {
      key = `${format}:id:${id}`;
    } else if (validIndex(envelopeIndex)) {
      key = `${format}:index:${envelopeIndex}`;
    } else if (position !== null) {
      key = `${format}:position:${position}`;
    } else {
      calls.push({ key: null, name: item.name });
      return;
    }
    calls.push({ key, name: item.name });
  };

  if (payload?.type === "content_block_start") add("claude", payload.content_block, payload.index);
  for (const [position, block] of (payload?.content || []).entries()) add("claude", block, null, position);
  for (const [position, item] of (payload?.output || []).entries()) add("responses", item, null, position);
  for (const [position, item] of (payload?.response?.output || []).entries()) add("responses", item, null, position);
  add("responses", payload?.item, payload?.output_index);
  return calls;
}

export function createOpenCodeToolResponseGuard(metadata, { getReservedBytes = () => 0 } = {}) {
  const calls = new Map();
  const held = [];
  let heldBytes = 0;

  const fail = (code, message) => {
    throw new OpenCodeToolResponseGuardError(code, message);
  };

  const hasUnresolved = () => [...calls.values()].some((state) => !state.resolved);

  const hold = (event, serializedSize) => {
    const size = eventSize(event, serializedSize);
    if (getReservedBytes() + heldBytes + size > OPENCODE_GUARD_LIMITS.MAX_BUFFERED_SUFFIX_BYTES) {
      fail("upstream_tool_buffer_overflow", "Upstream tool response exceeded the safety buffer");
    }
    held.push(event);
    heldBytes += size;
    return [];
  };

  const release = (event, serializedSize) => {
    if (held.length === 0) return [event];
    const size = eventSize(event, serializedSize);
    if (getReservedBytes() + heldBytes + size > OPENCODE_GUARD_LIMITS.MAX_BUFFERED_SUFFIX_BYTES) {
      fail("upstream_tool_buffer_overflow", "Upstream tool response exceeded the safety buffer");
    }
    held.push(event);
    const releasedEvents = held.splice(0);
    heldBytes = 0;
    return releasedEvents;
  };

  const validateName = (name) => {
    if (typeof name !== "string") {
      fail("upstream_tool_malformed", "Upstream tool response has an invalid tool identity");
    }
    if (byteLength(name) > OPENCODE_GUARD_LIMITS.MAX_NAME_BYTES) {
      fail("upstream_tool_name_limit", "Upstream tool response exceeded the name limit");
    }
  };

  const validateComplete = (name) => {
    validateName(name);
    if (isInjected(name, metadata)) {
      fail("upstream_undeclared_tool", "Upstream selected an undeclared tool");
    }
  };

  const stateFor = (key) => {
    let state = calls.get(key);
    if (!state) {
      if (calls.size >= OPENCODE_GUARD_LIMITS.MAX_TRACKED_CALLS) {
        fail("upstream_tool_call_limit", "Upstream tool response exceeded the call limit");
      }
      state = { name: "", resolved: false, fragments: [] };
      calls.set(key, state);
    }
    return state;
  };

  const rewriteChatName = (event, fragment, name) => {
    const choice = event?.payload?.choices?.[fragment.choicePosition];
    const holder = choice?.[fragment.holder];
    const call = holder?.tool_calls?.[fragment.callPosition];
    if (!call?.function) return;
    const choices = [...event.payload.choices];
    const nextChoice = { ...choice };
    const nextHolder = { ...holder, tool_calls: [...holder.tool_calls] };
    const nextCall = { ...call, function: { ...call.function } };
    if (name === undefined) delete nextCall.function.name;
    else nextCall.function.name = name;
    nextHolder.tool_calls[fragment.callPosition] = nextCall;
    nextChoice[fragment.holder] = nextHolder;
    choices[fragment.choicePosition] = nextChoice;
    event.payload = { ...event.payload, choices };
    event.normalized = true;
  };

  const normalizeFragments = (state) => {
    if (state.fragments.length === 0) return;
    const [first, ...rest] = state.fragments;
    rewriteChatName(first.event, first, state.name);
    for (const fragment of rest) rewriteChatName(fragment.event, fragment, undefined);
    state.fragments = [];
  };

  const resolveChatState = (state, name) => {
    validateComplete(name);
    state.name = name;
    state.resolved = true;
    normalizeFragments(state);
  };

  const consumeChat = (payload, event) => {
    for (const call of chatToolCalls(payload)) {
      const { choiceIndex, callIndex, name, holder } = call;
      const state = stateFor(`chat:${choiceIndex}:${callIndex}`);
      if (holder === "message") {
        validateName(name);
        if (!state.resolved) {
          const hadFragments = state.fragments.length > 0;
          resolveChatState(state, name);
          if (hadFragments) {
            rewriteChatName(event, { choicePosition: call.choicePosition, callPosition: call.callPosition, holder }, undefined);
          }
        } else {
          rewriteChatName(event, { choicePosition: call.choicePosition, callPosition: call.callPosition, holder }, undefined);
        }
        continue;
      }
      if (name === undefined) {
        if (!state.name) {
          fail("upstream_tool_malformed", "Upstream tool response has an invalid tool identity");
        }
        continue;
      }
      if (state.resolved) {
        rewriteChatName(event, { choicePosition: call.choicePosition, callPosition: call.callPosition, holder }, undefined);
        continue;
      }
      validateName(name);
      state.name += name;
      state.fragments.push({ event, choicePosition: call.choicePosition, callPosition: call.callPosition, holder });
      if (byteLength(state.name) > OPENCODE_GUARD_LIMITS.MAX_NAME_BYTES) {
        fail("upstream_tool_name_limit", "Upstream tool response exceeded the name limit");
      }
    }
  };

  const finalizeChoices = (payload) => {
    for (const [choicePosition, choice] of (payload?.choices || []).entries()) {
      if (choice?.finish_reason == null) continue;
      const choiceIndex = Number.isInteger(choice?.index) ? choice.index : choicePosition;
      for (const [key, state] of calls.entries()) {
        if (!key.startsWith(`chat:${choiceIndex}:`) || state.resolved) continue;
        if (metadata?.renameMap?.has(state.name)) {
          resolveChatState(state, state.name);
          continue;
        }
        if (isInjected(state.name, metadata)) {
          fail("upstream_undeclared_tool", "Upstream selected an undeclared tool");
        }
        if (isPotentialInjectedPrefix(state.name, metadata)) {
          fail("upstream_tool_unresolved", "Upstream tool response ended with an unresolved tool identity");
        }
        resolveChatState(state, state.name);
      }
    }
  };

  return {
    consume({ payload, event = "", serializedSize } = {}) {
      if (!metadata?.injectedNames) return { releasedEvents: [event] };
      for (const complete of completeToolCalls(payload)) {
        if (!complete.key) {
          fail("upstream_tool_malformed", "Upstream tool response has an invalid tool identity");
        }
        const state = stateFor(complete.key);
        validateComplete(complete.name);
        state.name = complete.name;
        state.resolved = true;
      }
      if (Array.isArray(payload?.choices)) {
        consumeChat(payload, event);
        finalizeChoices(payload);
      }
      if (hasUnresolved()) return { releasedEvents: hold(event, serializedSize) };
      return { releasedEvents: release(event, serializedSize) };
    },

    getHeldBytes() {
      return heldBytes;
    },

    assertCapacity() {
      if (getReservedBytes() + heldBytes > OPENCODE_GUARD_LIMITS.MAX_BUFFERED_SUFFIX_BYTES) {
        fail("upstream_tool_buffer_overflow", "Upstream tool response exceeded the safety buffer");
      }
    },

    finish() {
      if (hasUnresolved()) {
        fail("upstream_tool_unresolved", "Upstream tool response ended with an unresolved tool identity");
      }
      const releasedEvents = held.splice(0);
      heldBytes = 0;
      return { releasedEvents };
    },
  };
}
