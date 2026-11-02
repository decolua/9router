// Stateful decoder for ChatGPT's compact `delta_encoding: v1` document stream.

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneValue(value) {
  return structuredClone(value);
}

const DELTA_OPERATIONS = new Set(["add", "append", "patch", "replace"]);
const UNSAFE_POINTER_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

function assertSafeValue(value) {
  if (Array.isArray(value)) {
    for (const item of value) assertSafeValue(item);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (UNSAFE_POINTER_SEGMENTS.has(key)) {
      throw new Error(`Unsafe object key in ChatGPT Web delta: ${key}`);
    }
    assertSafeValue(item);
  }
}

function parseJson(data) {
  try {
    return { parsed: true, value: JSON.parse(data) };
  } catch {
    return { parsed: false };
  }
}

/** Parse one plain-text `encoded_item` into its SSE-compatible frames. */
export function parseChatGptWebEncodedItem(encodedItem) {
  const events = [];
  const lines = encodedItem.replace(/\r\n?/g, "\n").split("\n");
  let eventName = "message";
  let dataLines = [];
  let hasData = false;

  const dispatch = () => {
    if (!hasData) {
      eventName = "message";
      dataLines = [];
      return;
    }
    const data = dataLines.join("\n");
    const parsed = data === "[DONE]" ? { parsed: false } : parseJson(data);
    events.push({
      event: eventName,
      data,
      ...(parsed.parsed ? { json: parsed.value } : {}),
      done: data === "[DONE]",
    });
    eventName = "message";
    dataLines = [];
    hasData = false;
  };

  for (const line of lines) {
    if (line === "") {
      dispatch();
      continue;
    }
    if (line.startsWith(":")) continue;

    const colon = line.indexOf(":");
    const field = colon >= 0 ? line.slice(0, colon) : line;
    let value = colon >= 0 ? line.slice(colon + 1) : "";
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "event") {
      eventName = value || "message";
    } else if (field === "data") {
      dataLines.push(value);
      hasData = true;
    }
  }
  dispatch();
  return events;
}

function pointerSegments(pointer) {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) {
    throw new Error(`Invalid ChatGPT Web JSON Pointer: ${pointer}`);
  }
  return pointer
    .slice(1)
    .split("/")
    .map((segment) => {
      const decoded = segment.replace(/~1/g, "/").replace(/~0/g, "~");
      if (UNSAFE_POINTER_SEGMENTS.has(decoded)) {
        throw new Error(`Unsafe JSON Pointer segment: ${decoded}`);
      }
      return decoded;
    });
}

function arrayIndex(segment, length, allowEnd) {
  if (allowEnd && segment === "-") return length;
  if (!/^(?:0|[1-9]\d*)$/.test(segment)) {
    throw new Error(`Invalid ChatGPT Web array index: ${segment}`);
  }
  const index = Number(segment);
  const upperBound = allowEnd ? length : length - 1;
  if (!Number.isSafeInteger(index) || index < 0 || index > upperBound) {
    throw new Error(`ChatGPT Web array index is out of bounds: ${segment}`);
  }
  return index;
}

function appendValue(current, incoming) {
  assertSafeValue(incoming);
  if (current === undefined || current === null) return cloneValue(incoming);
  if (typeof current === "string" && typeof incoming === "string") return current + incoming;
  if (Array.isArray(current)) {
    const result = cloneValue(current);
    if (Array.isArray(incoming)) result.push(...cloneValue(incoming));
    else result.push(cloneValue(incoming));
    return result;
  }
  if (isRecord(current) && isRecord(incoming)) {
    return { ...cloneValue(current), ...cloneValue(incoming) };
  }
  throw new Error(`Cannot append ChatGPT Web delta values (${typeof current}, ${typeof incoming})`);
}

function requireOperation(value) {
  if (typeof value !== "string" || !DELTA_OPERATIONS.has(value)) {
    throw new Error(`Unsupported delta operation: ${String(value)}`);
  }
  return value;
}

/** Stateful decoder for the compact `delta_encoding: v1` document stream. */
export class ChatGptWebDeltaV1Decoder {
  constructor() {
    this.document = null;
    this.lastPath = null;
    this.lastOperation = null;
    this.streamDone = false;
  }

  snapshot() {
    return cloneValue(this.document);
  }

  ingest(encodedItem) {
    const events = parseChatGptWebEncodedItem(encodedItem);
    let changed = false;

    for (const event of events) {
      if (event.event === "delta_encoding") {
        if (event.json !== "v1") {
          throw new Error(`Unsupported ChatGPT Web delta encoding: ${String(event.json)}`);
        }
        this.document = null;
        this.lastPath = null;
        this.lastOperation = null;
        this.streamDone = false;
        continue;
      }
      if (event.event === "delta") {
        this.applyDelta(event.json);
        changed = true;
      }
      if (event.done) this.streamDone = true;
    }

    return { events, changed, done: this.streamDone };
  }

  applyDelta(value) {
    if (!isRecord(value)) throw new Error("ChatGPT Web delta payload must be an object");
    const path = value.p === undefined ? this.lastPath : value.p;
    const operation = value.o === undefined ? this.lastOperation : requireOperation(value.o);
    if (typeof path !== "string" || operation === null) {
      throw new Error("ChatGPT Web delta requires a current or inherited path and operation");
    }
    this.lastPath = path;
    this.lastOperation = operation;
    this.applyAt(path, operation, value.v);
  }

  applyAt(path, operation, value) {
    assertSafeValue(value);
    const segments = pointerSegments(path);
    if (segments.length === 0) {
      this.applyAtRoot(operation, value);
      return;
    }

    let parent = this.document;
    for (const segment of segments.slice(0, -1)) {
      if (Array.isArray(parent)) {
        parent = parent[arrayIndex(segment, parent.length, false)];
      } else if (isRecord(parent) && Object.hasOwn(parent, segment)) {
        parent = parent[segment];
      } else {
        throw new Error(`ChatGPT Web delta path does not exist: ${path}`);
      }
    }

    const key = segments[segments.length - 1];
    if (Array.isArray(parent)) {
      this.applyToArray(parent, key, operation, value);
      return;
    }
    if (!isRecord(parent)) throw new Error(`ChatGPT Web delta path is not mutable: ${path}`);
    this.applyToObject(parent, key, operation, value);
  }

  applyAtRoot(operation, value) {
    if (operation === "add" || operation === "replace") {
      this.document = cloneValue(value);
      return;
    }
    if (operation === "append") {
      this.document = appendValue(this.document, value);
      return;
    }
    if (!Array.isArray(value)) throw new Error("ChatGPT Web patch value must be an array");
    for (const entry of value) {
      if (!isRecord(entry) || typeof entry.p !== "string") {
        throw new Error("ChatGPT Web patch entry requires an explicit path and operation");
      }
      this.applyAt(entry.p, requireOperation(entry.o), entry.v);
    }
  }

  applyToArray(target, key, operation, value) {
    if (operation === "patch") throw new Error("Nested ChatGPT Web patch is unsupported");
    if (operation === "add") {
      target.splice(arrayIndex(key, target.length, true), 0, cloneValue(value));
      return;
    }
    const index = arrayIndex(key, target.length, false);
    target[index] = operation === "append" ? appendValue(target[index], value) : cloneValue(value);
  }

  applyToObject(target, key, operation, value) {
    if (operation === "patch") throw new Error("Nested ChatGPT Web patch is unsupported");
    if (operation !== "add" && !Object.hasOwn(target, key)) {
      throw new Error(`ChatGPT Web delta target does not exist: ${key}`);
    }
    target[key] = operation === "append" ? appendValue(target[key], value) : cloneValue(value);
  }
}
