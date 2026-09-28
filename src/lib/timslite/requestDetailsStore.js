import { createHash } from "node:crypto";

import { TIMSLITE_REQUEST_DETAILS_PATH } from "@/lib/db/paths.js";

const DEFAULT_RETENTION_DAYS = 7;
const DEFAULT_FLUSH_INTERVAL_SECONDS = 15;
export const TIMSLITE_RECORD_MAX_BYTES = 4 * 1024 * 1024;
export const TIMSLITE_RECORD_SAFE_BYTES = TIMSLITE_RECORD_MAX_BYTES - 64 * 1024;
const DATASET_NAME = "requestDetails";
const DATASET_TYPE = "raw";
const MIN_TRUNCATION_MARKER_BYTES = Buffer.byteLength(JSON.stringify({ __truncated: true }), "utf8");

const TRUNCATABLE_FIELDS = ["request", "providerRequest", "providerResponse", "response"];

const DEDUP_FIELDS = ["request", "providerRequest"];

// Shape policy inside each deduped container: messages/input arrays dedup per
// element; tools (array) and instructions (string) collapse to one whole value.
const CONTAINER_ITEM_FIELDS = ["messages", "input"];
const CONTAINER_WHOLE_ARRAY_FIELDS = ["tools"];
const CONTAINER_WHOLE_STRING_FIELDS = ["instructions"];

const VALUES_KEY = "__values__";

// Ref wire format "#/<timslite_id>/<values_index>" with both parts decimal:
// id=0 means the record's own __values__ array, a nonzero id is another record
// and the index addresses that record's __values__ array. Ordinary strings and
// legacy 64-hex refs never match.
export const TIMSLITE_VALUE_REF_PATTERN = /^#\/(0|[1-9]\d{0,19})\/(0|[1-9]\d*)$/;

export const TIMSLITE_VALUE_CACHE_MAX_ENTRIES = 2048;


const MICROSECONDS_PER_HOUR = 60n * 60n * 1_000_000n;
const FORTY_EIGHT_HOURS_MICROSECONDS = 48n * MICROSECONDS_PER_HOUR;

// Cross-record reuse stays within the retention window minus one hour of
// safety margin, capped at 48h; a non-positive budget disables it.
export function computeCrossRecordTtlMicroseconds(retentionWindow) {
  const budget = retentionWindow - MICROSECONDS_PER_HOUR;
  const ttl = budget < FORTY_EIGHT_HOURS_MICROSECONDS ? budget : FORTY_EIGHT_HOURS_MICROSECONDS;
  return ttl > 0n ? ttl : 0n;
}

function sha256Hex(str) {
  return createHash("sha256").update(str, "utf8").digest("hex");
}

// Module-global LRU state shared across all createValueCache instances.
// Each store instance applies its own effective TTL when reading entries.
const globalEntries = new Map();

// Reset global cache state. Exported for test isolation.
export function _resetGlobalValueCache() {
  globalEntries.clear();
}

// Cache stores { ref, writtenAt } per SHA — the persisted cross-record ref
// string, never the value itself. Backing map is module-global so refs survive
// across store instances.
export function createValueCache({ maxEntries = TIMSLITE_VALUE_CACHE_MAX_ENTRIES, ttlMicroseconds = 0n, clock = Date.now } = {}) {
  function nowMicros() {
    return BigInt(clock()) * 1000n;
  }

  function isExpired(entry, now) {
    return ttlMicroseconds <= 0n || now - entry.writtenAt >= ttlMicroseconds;
  }

  return {
    get enabled() {
      return ttlMicroseconds > 0n;
    },
    ttlMicroseconds,
    // Returns the full persisted cross-record ref string for the cached SHA.
    getRef(sha) {
      if (ttlMicroseconds <= 0n) return undefined;
      const entry = globalEntries.get(sha);
      if (entry === undefined) return undefined;
      if (isExpired(entry, nowMicros())) {
        globalEntries.delete(sha);
        return undefined;
      }
      // Move to end (most recently used)
      globalEntries.delete(sha);
      globalEntries.set(sha, entry);
      return entry.ref;
    },
    // Store the full cross-record ref string for a SHA after a successful write.
    setRef(sha, ref, writtenAtMicros = nowMicros()) {
      if (ttlMicroseconds <= 0n) return;
      globalEntries.delete(sha);
      globalEntries.set(sha, { ref, writtenAt: writtenAtMicros });
      // Evict LRU entries down to exactly maxEntries. The target must never
      // dip below 0: a negative bound would spin forever on an empty map.
      while (globalEntries.size > maxEntries) {
        const oldest = globalEntries.keys().next().value;
        globalEntries.delete(oldest);
      }
    },
    get size() {
      return globalEntries.size;
    },
    clear() {
      globalEntries.clear();
    },
  };
}

export function getTimsliteRetentionDays(env = process.env) {
  const raw = env.OBSERVABILITY_TIMSLITE_RETENTION_DAYS;
  if (raw === undefined || raw === null) return DEFAULT_RETENTION_DAYS;

  const trimmed = String(raw).trim();
  if (!/^[1-9]\d*$/.test(trimmed)) return DEFAULT_RETENTION_DAYS;

  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value <= 0) return DEFAULT_RETENTION_DAYS;

  return value;
}

function parsePositiveIntegerSeconds(raw, fallbackSeconds) {
  if (raw === undefined || raw === null) return fallbackSeconds;

  const trimmed = String(raw).trim();
  if (!/^[1-9]\d*$/.test(trimmed)) return fallbackSeconds;

  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value <= 0) return fallbackSeconds;

  return value;
}

export function getTimsliteFlushIntervalMs(env = process.env) {
  const seconds = parsePositiveIntegerSeconds(
    env.OBSERVABILITY_TIMSLITE_FLUSH_INTERVAL_SECONDS,
    DEFAULT_FLUSH_INTERVAL_SECONDS,
  );
  return seconds * 1000;
}

function daysToMicroseconds(days) {
  return BigInt(days) * 24n * 60n * 60n * 1_000_000n;
}

// Dataset timestamps and the retention window share one unit — hundredths of a
// second — so expired-record math compares like with like.
function daysToHundredthsOfSecond(days) {
  return BigInt(days) * 24n * 60n * 60n * 100n;
}

const SECONDS_TO_HUNDREDTHS = 100n;
const MAX_SEQUENCE_PER_SECOND = 99n;

// Logical id = unixSeconds * 100 + sequence, sequence 00-99. The 101st call
// inside one wall-clock second waits (via injectable wait, defaulting to a
// real timer) for the next second instead of throwing or overflowing into it
// early. A clock step backwards keeps ids strictly increasing without waiting.
export function createMonotonicCentisecondId(
  clock = Date.now,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  let lastId = 0n;
  return {
    async next() {
      for (;;) {
        const nowMs = BigInt(Math.floor(clock()));
        const base = (nowMs / 1000n) * SECONDS_TO_HUNDREDTHS;
        if (lastId < base) {
          lastId = base;
          return lastId;
        }
        if (lastId >= base + SECONDS_TO_HUNDREDTHS) {
          if (lastId % SECONDS_TO_HUNDREDTHS < MAX_SEQUENCE_PER_SECOND) {
            lastId += 1n;
            return lastId;
          }
          const nextId = lastId + 1n;
          await wait(Number((nextId / SECONDS_TO_HUNDREDTHS) * 1000n - nowMs));
          continue;
        }
        if (lastId % SECONDS_TO_HUNDREDTHS < MAX_SEQUENCE_PER_SECOND) {
          lastId += 1n;
          return lastId;
        }
        await wait(Number((nowMs / 1000n + 1n) * 1000n - nowMs));
      }
    },
    seedFrom(timestamp) {
      const ts = BigInt(timestamp);
      if (ts > lastId) lastId = ts;
    },
  };
}

function utf8ByteLength(str) {
  return Buffer.byteLength(str, "utf8");
}

function truncateStringToUtf8Budget(str, maxBytes) {
  let low = 0;
  let high = str.length;
  let best = "";
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const slice = str.slice(0, mid);
    const bytes = utf8ByteLength(slice);
    if (bytes <= maxBytes) {
      best = slice;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

export function truncateUtf8Json(value, maxBytes = TIMSLITE_RECORD_SAFE_BYTES) {
  if (maxBytes < MIN_TRUNCATION_MARKER_BYTES) {
    throw new RangeError(`maxBytes ${maxBytes} is below minimum truncation marker size ${MIN_TRUNCATION_MARKER_BYTES}`);
  }

  const fullSerialized = JSON.stringify(value);
  const originalBytes = utf8ByteLength(fullSerialized);
  if (originalBytes <= maxBytes) return fullSerialized;

  const clone = structuredClone(value);
  const envelope = { __truncated: true, __originalBytes: originalBytes };

  for (const field of TRUNCATABLE_FIELDS) {
    if (clone[field] !== undefined) {
      const fieldSerialized = JSON.stringify(clone[field]);
      const fieldBytes = utf8ByteLength(fieldSerialized);
      clone[field] = {
        __truncated: true,
        __originalBytes: fieldBytes,
        __preview: truncateStringToUtf8Budget(fieldSerialized, 256),
      };
    }
  }

  const withTruncatedFields = JSON.stringify({ ...envelope, ...clone });
  if (utf8ByteLength(withTruncatedFields) <= maxBytes) return withTruncatedFields;

  const minimalEnvelope = JSON.stringify(envelope);
  if (utf8ByteLength(minimalEnvelope) <= maxBytes) return minimalEnvelope;

  return JSON.stringify({ __truncated: true });
}

// Deliberately strict: only literal "true" opts in; "TRUE"/" true "/"1" stay inline.
export function isTimsliteDataStoreEnabled(env = process.env) {
  return env.OBSERVABILITY_TIMSLITE_DATA_STORE === "true";
}

function isValidDecimalId(id) {
  return typeof id === "string" && /^\d+$/.test(id);
}

// Replaces request/providerRequest messages/input items and whole tools
// arrays / instructions strings with a ref.
// Local first occurrence: "#/0/{index}" appended to the __values__ array.
// Cross-record cache hit: the cached full "#/{timslite_id}/{index}" string is
// written verbatim (no local value stored).
// A payload that already occupies the top-level __values__ key is left
// completely untouched (fail open) so no payload data is overwritten or lost.
function deduplicateMessages(original, cache) {
  if (Object.prototype.hasOwnProperty.call(original, VALUES_KEY)) {
    return { record: original, commits: [] };
  }

  const clone = structuredClone(original);
  const values = [];
  const localIndexBySha = new Map();
  const commits = [];

  const resolveRef = (value) => {
    let serialized;
    try {
      serialized = JSON.stringify(value);
    } catch {
      return undefined;
    }
    if (serialized === undefined) return undefined;

    const sha = sha256Hex(serialized);
    const localIndex = localIndexBySha.get(sha);
    if (localIndex !== undefined) return `#/0/${localIndex}`;

    const cachedRef = cache ? cache.getRef(sha) : undefined;
    if (cachedRef !== undefined) return cachedRef;

    const index = values.length;
    values.push(structuredClone(value));
    localIndexBySha.set(sha, index);
    commits.push({ sha, index });
    return `#/0/${index}`;
  };

  for (const field of DEDUP_FIELDS) {
    const container = clone[field];
    if (!container || typeof container !== "object") continue;

    // messages/input: per-item dedup (each element → individual ref)
    for (const key of CONTAINER_ITEM_FIELDS) {
      if (!Array.isArray(container[key])) continue;
      const items = container[key];
      for (let i = 0; i < items.length; i += 1) {
        if (typeof items[i] === "string" && TIMSLITE_VALUE_REF_PATTERN.test(items[i])) {
          continue;
        }
        const ref = resolveRef(items[i]);
        if (ref !== undefined) items[i] = ref;
      }
    }

    // tools (array) / instructions (string): whole-value dedup → single ref
    for (const key of CONTAINER_WHOLE_ARRAY_FIELDS) {
      const value = container[key];
      if (typeof value === "string" && TIMSLITE_VALUE_REF_PATTERN.test(value)) {
        // already a strict ref string — pass through
      } else if (Array.isArray(value)) {
        const ref = resolveRef(value);
        if (ref !== undefined) container[key] = ref;
      }
    }
    for (const key of CONTAINER_WHOLE_STRING_FIELDS) {
      const value = container[key];
      if (typeof value === "string" && !TIMSLITE_VALUE_REF_PATTERN.test(value)) {
        const ref = resolveRef(value);
        if (ref !== undefined) container[key] = ref;
      }
    }
  }

  if (values.length > 0) clone[VALUES_KEY] = values;
  return { record: clone, commits };
}

// Resolves refs in a single record's messages/tools using the record's own
// __values__ array plus batch-fetched cross-record arrays. No hash recomputation
// on read, and no ref is ever rewritten to another form: unknown refs fail open.
// Only a well-formed protocol array is consumed and removed; any other shape
// that a payload happens to occupy at __values__ is left untouched.
async function resolveMessages(record, dataset, log) {
  const rawValues = record[VALUES_KEY];
  const hasValidLocalValues = Array.isArray(rawValues);
  const values = hasValidLocalValues ? rawValues : [];

  const crossRecordIds = new Set();
  for (const field of DEDUP_FIELDS) {
    const container = record[field];
    if (!container || typeof container !== "object") continue;

    // messages/input: scan per-item refs in arrays
    for (const key of CONTAINER_ITEM_FIELDS) {
      if (!Array.isArray(container[key])) continue;
      for (const ref of container[key]) {
        if (typeof ref !== "string") continue;
        const match = TIMSLITE_VALUE_REF_PATTERN.exec(ref);
        if (match && match[1] !== "0") crossRecordIds.add(match[1]);
      }
    }

    // tools/instructions: scan whole-value ref string
    for (const key of [...CONTAINER_WHOLE_ARRAY_FIELDS, ...CONTAINER_WHOLE_STRING_FIELDS]) {
      if (typeof container[key] === "string") {
        const match = TIMSLITE_VALUE_REF_PATTERN.exec(container[key]);
        if (match && match[1] !== "0") crossRecordIds.add(match[1]);
      }
    }
  }

  let crossValues = null;
  if (crossRecordIds.size > 0 && dataset) {
    const fetched = new Map();
    for (const id of crossRecordIds) {
      try {
        const ts = BigInt(id);
        const rec = await dataset.read(ts);
        if (rec) {
          const parsed = JSON.parse(rec[1].toString("utf8"));
          if (Array.isArray(parsed[VALUES_KEY])) {
            fetched.set(id, parsed[VALUES_KEY]);
          }
        }
      } catch (err) {
        log.warn("timslite.crossRecordRead", { id, error: err.message });
      }
    }
    if (fetched.size > 0) crossValues = fetched;
  }

  let resolvedLocalRef = false;
  const resolveIndex = (id, index) => {
    if (id === "0") {
      if (index >= values.length) return undefined;
      resolvedLocalRef = true;
      return values[index];
    }
    const sourceValues = crossValues ? crossValues.get(id) : undefined;
    if (!sourceValues || index >= sourceValues.length) return undefined;
    return sourceValues[index];
  };

  for (const field of DEDUP_FIELDS) {
    const container = record[field];
    if (!container || typeof container !== "object") continue;

    // messages/input: per-item resolve
    for (const key of CONTAINER_ITEM_FIELDS) {
      if (!Array.isArray(container[key])) continue;
      const items = container[key];
      for (let i = 0; i < items.length; i += 1) {
        const ref = items[i];
        if (typeof ref !== "string") continue;
        const match = TIMSLITE_VALUE_REF_PATTERN.exec(ref);
        if (!match) continue;
        const resolved = resolveIndex(match[1], Number(match[2]));
        if (resolved !== undefined) items[i] = resolved;
      }
    }

    // tools/instructions: whole-value ref resolve
    for (const key of [...CONTAINER_WHOLE_ARRAY_FIELDS, ...CONTAINER_WHOLE_STRING_FIELDS]) {
      if (typeof container[key] !== "string") continue;
      const match = TIMSLITE_VALUE_REF_PATTERN.exec(container[key]);
      if (match) {
        const resolved = resolveIndex(match[1], Number(match[2]));
        if (resolved !== undefined) container[key] = resolved;
      }
    }
  }

  if (hasValidLocalValues && resolvedLocalRef) delete record[VALUES_KEY];
  return record;
}

async function createDefaultAdapter() {
  const timslite = await import("timslite");
  return {
    async openStore(dataDir, config) {
      const store = timslite.Store.open(dataDir, config);
      return {
        async createDataset(name, type, options) {
          store.createDataset(name, type, options);
        },
        async openDataset(name, type) {
          const dataset = store.openDataset(name, type);
          return {
            async write(timestamp, data) {
              dataset.write(BigInt(timestamp), data);
            },
            async read(timestamp) {
              return dataset.read(BigInt(timestamp));
            },
            async readLatest() {
              return dataset.readLatest();
            },
            async flush() {
              
            },
            async close() {
              dataset.close();
            },
          };
        },
        async close() {
          store.close();
        },
      };
    },
  };
}

export function createRequestDetailsStore({ adapter, env = process.env, clock, wait, logger } = {}) {
  const enabled = isTimsliteDataStoreEnabled(env);
  const idGen = createMonotonicCentisecondId(clock, wait);
  const retentionDays = getTimsliteRetentionDays(env);
  const retentionWindow = daysToHundredthsOfSecond(retentionDays);
  const flushIntervalMs = getTimsliteFlushIntervalMs(env);
  const log = logger || { warn: () => {} };

  // The cache ages entries by wall-clock microseconds, so its budget derives
  // from the retention days in µs, not from the dataset's seconds-x-100 window.
  const crossRecordTtlMicroseconds = computeCrossRecordTtlMicroseconds(daysToMicroseconds(retentionDays));
  const valueCache = createValueCache({ ttlMicroseconds: crossRecordTtlMicroseconds, clock });

  let store = null;
  let dataset = null;
  let initialized = false;
  let closed = false;
  let initPromise = null;
  const staged = [];

  async function initialize() {
    if (closed) return null;
    if (initialized) return { store, dataset };
    if (initPromise) return initPromise;

    initPromise = (async () => {
      const adapterImpl = adapter || await createDefaultAdapter();
      store = await adapterImpl.openStore(TIMSLITE_REQUEST_DETAILS_PATH, { readOnly: false, flushIntervalMs });
      if (store.readOnly === true) {
        throw new Error("Timslite store opened in read-only mode; cannot write request details");
      }
      try {
        await store.createDataset(DATASET_NAME, DATASET_TYPE, { retentionWindow: retentionWindow, indexContinuous: false, enableJournal: false, timestampUnitsPerSeconds: 100 });
      } catch (err) {
        log.warn("timslite.createDataset", { error: err.message });
      }
      dataset = await store.openDataset(DATASET_NAME, DATASET_TYPE);
      const latest = await dataset.readLatest();
      if (latest) {
        idGen.seedFrom(latest[0]);
      }
      initialized = true;
      return { store, dataset };
    })();

    return initPromise;
  }

  async function initializeReadOnly() {
    if (closed) return null;
    if (dataset) return { store, dataset };
    if (initPromise) return initPromise;

    initPromise = (async () => {
      const adapterImpl = adapter || await createDefaultAdapter();
      store = await adapterImpl.openStore(TIMSLITE_REQUEST_DETAILS_PATH, { readOnly: true });
      try {
        dataset = await store.openDataset(DATASET_NAME, DATASET_TYPE);
      } catch (err) {
        log.warn("timslite.openDataset.readOnly", { error: err.message });
        return null;
      }
      return { store, dataset };
    })();

    return initPromise;
  }

  async function stage(detail) {
    if (!enabled) return null;
    await initialize();
    const id = await idGen.next();
    const cloned = structuredClone(detail);
    staged.push({ id, original: cloned });
    return { timslite_id: id.toString() };
  }

  function serializeForWrite(original) {
    try {
      const { record, commits } = deduplicateMessages(original, valueCache);
      const compressed = JSON.stringify(record);
      if (utf8ByteLength(compressed) <= TIMSLITE_RECORD_SAFE_BYTES) {
        return { value: compressed, commits };
      }
    } catch (err) {
      log.warn("timslite.compress", { error: err.message });
    }
    return { value: truncateUtf8Json(original), commits: [] };
  }

  async function flush() {
    if (!enabled) return;
    if (staged.length === 0) {
      await initialize();
      if (dataset) await dataset.flush();
      return;
    }
    await initialize();
    for (let idx = 0; idx < staged.length; idx += 1) {
      const { id, original } = staged[idx];
      const nowMicros = BigInt(clock ? clock() : Date.now()) * 1000n;

      // Update staged record to replace local refs with cross-record refs
      // for values already written by earlier records in this flush batch.
      const recordForWrite = updateStagedRefs(original);
      const { value, commits } = serializeForWrite(recordForWrite);
      await dataset.write(id, Buffer.from(value, "utf8"));
      for (const { sha, index } of commits) {
        valueCache.setRef(sha, `#/${id.toString()}/${index}`, nowMicros);
      }
    }
    await dataset.flush();
    staged.length = 0;
  }

  // A local ref addresses a value by array index, so the SHA needed for the
  // cache lookup has to be recomputed from the record's own __values__ array.
  function updateStagedRefs(original) {
    const localValues = Array.isArray(original[VALUES_KEY]) ? original[VALUES_KEY] : null;
    if (!localValues) return original;

    const refForIndex = (index) => {
      if (index >= localValues.length) return undefined;
      let serialized;
      try {
        serialized = JSON.stringify(localValues[index]);
      } catch {
        return undefined;
      }
      if (serialized === undefined) return undefined;
      return valueCache.getRef(sha256Hex(serialized));
    };

    let modified = false;
    const clone = structuredClone(original);
    for (const field of DEDUP_FIELDS) {
      const container = clone[field];
      if (!container || typeof container !== "object") continue;

      // messages/input: per-item ref update
      for (const key of CONTAINER_ITEM_FIELDS) {
        if (!Array.isArray(container[key])) continue;
        const items = container[key];
        for (let i = 0; i < items.length; i += 1) {
          const ref = items[i];
          if (typeof ref !== "string") continue;
          const match = TIMSLITE_VALUE_REF_PATTERN.exec(ref);
          if (!match || match[1] !== "0") continue;
          const cachedRef = refForIndex(Number(match[2]));
          if (cachedRef !== undefined) {
            items[i] = cachedRef;
            modified = true;
          }
        }
      }

      // tools/instructions: whole-value ref string update
      for (const key of [...CONTAINER_WHOLE_ARRAY_FIELDS, ...CONTAINER_WHOLE_STRING_FIELDS]) {
        if (typeof container[key] !== "string") continue;
        const match = TIMSLITE_VALUE_REF_PATTERN.exec(container[key]);
        if (match && match[1] === "0") {
          const cachedRef = refForIndex(Number(match[2]));
          if (cachedRef !== undefined) {
            container[key] = cachedRef;
            modified = true;
          }
        }
      }
    }
    return modified ? clone : original;
  }

  async function discard() {
    staged.length = 0;
  }

  async function getMany(ids, { resolveValues = true } = {}) {
    const result = new Map();
    if (ids.length === 0) return result;

    const validIds = [];
    for (const id of ids) {
      if (isValidDecimalId(id)) {
        validIds.push(id);
        result.set(id, null);
      } else {
        result.set(id, null);
      }
    }

    const unique = [...new Set(validIds)];
    if (unique.length === 0) return result;

    try {
      if (!dataset) {
        if (enabled) {
          await initialize();
        } else {
          await initializeReadOnly();
        }
      }
      if (!dataset) return result;

      for (const id of unique) {
        try {
          const ts = BigInt(id);
          const record = await dataset.read(ts);
          if (!record) {
            continue;
          }
          const parsed = JSON.parse(record[1].toString("utf8"));
          result.set(id, resolveValues ? await resolveMessages(parsed, dataset, log) : parsed);
        } catch (err) {
          log.warn("timslite.read", { id, error: err.message });
        }
      }
    } catch (err) {
      log.warn("timslite.getMany", { error: err.message });
    }

    return result;
  }

  async function close() {
    if (closed) return;
    closed = true;
    if (dataset) {
      try {
        await dataset.close();
      } catch (err) {
        log.warn("timslite.close.dataset", { error: err.message });
      }
      dataset = null;
    }
    if (store) {
      try {
        await store.close();
      } catch (err) {
        log.warn("timslite.close.store", { error: err.message });
      }
      store = null;
    }
  }

  return { enabled, stage, flush, discard, getMany, close };
}
