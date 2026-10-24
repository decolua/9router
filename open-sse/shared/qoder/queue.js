/**
 * Qoder model-queue handling, reverse-engineered from qodercli 1.1.41.
 *
 * When a model is temporarily out of capacity Qoder answers the inference
 * request with a `{statusCodeValue, body}` SSE envelope whose body carries:
 *
 *   { "code": "10605",
 *     "message": "{\"isQueued\":true,\"modelKey\":\"auto\",\"queueCount\":0,
 *                  \"queueType\":\"p3\",\"retryAfterSeconds\":30,
 *                  \"serviceAvailable\":false,\"subCode\":\"RESOURCE_LIMIT\",
 *                  \"waitTime\":30}",
 *     "subCode": "RESOURCE_LIMIT" }
 *
 * That is a transient capacity signal, not a quota block: the model becomes
 * available again in ~30s and the same request then succeeds. qodercli keeps
 * the request open, polls the model-queue status endpoint, and replays the
 * inference once the model is ready.
 *
 * The payload is frequently double- or triple-encoded (the queue object lives
 * inside a JSON string inside a JSON string), so every lookup walks the nested
 * tree and parses JSON-encoded string fields as it goes.
 */

export const QODER_QUEUE_CODE = "10605";
export const QODER_MODEL_QUEUE_MAX_WAIT_ENV = "QODER_MODEL_QUEUE_MAX_WAIT_MS";

// qodercli caps the wait at 1h; that is far too long for a gateway holding a
// client request. The queue clears in ~30s windows, so 3 minutes covers several
// of them and still returns a retryable error instead of hanging. Raise it with
// QODER_MODEL_QUEUE_MAX_WAIT_MS when the caller can afford to wait.
const DEFAULT_MAX_WAIT_MS = 600_000;
const DEFAULT_RETRY_MS = 30_000;
// A sub-second floor came from qodercli, but Qoder's queue now answers
// retryAfterSeconds:2 while still refusing the request. Replaying that fast
// makes the throttle worse, so the floor is a full retry interval.
const MIN_RETRY_MS = 15_000;
const MAX_RETRY_MS = 60_000;
// The queue-status endpoint can report isQueued:false while the inference call
// is still refused, so its hint is not trusted below the default interval.
const STATUS_HINT_FLOOR_MS = 30_000;

const NESTED_KEYS = ["error", "data", "body", "message", "cause", "result", "payload"];

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function toNumber(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^-?\d+(?:\.\d+)?$/.test(v.trim())) return Number(v.trim());
  return undefined;
}

function toString(v) {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function toBool(v) {
  if (v === true || v === false) return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return undefined;
}

function tryParse(value) {
  if (typeof value !== "string") return undefined;
  const s = value.trim();
  if (!s || (s[0] !== "{" && s[0] !== "[")) return undefined;
  try {
    const parsed = JSON.parse(s);
    return isPlainObject(parsed) || Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Breadth-first walk over nested objects and JSON-encoded string fields.
 * Returns every plain object reachable from the root.
 */
function walkObjects(root) {
  const out = [];
  const seenObjects = new Set();
  const seenStrings = new Set();
  const queue = [root];
  while (queue.length > 0) {
    const node = queue.shift();
    if (isPlainObject(node)) {
      if (seenObjects.has(node)) continue;
      seenObjects.add(node);
      out.push(node);
      for (const key of NESTED_KEYS) {
        const v = node[key];
        if (isPlainObject(v) || Array.isArray(v)) {
          queue.push(v);
        } else if (typeof v === "string" && !seenStrings.has(v)) {
          seenStrings.add(v);
          const parsed = tryParse(v);
          if (parsed) queue.push(parsed);
        }
      }
    } else if (Array.isArray(node)) {
      for (const item of node) {
        if (isPlainObject(item) || Array.isArray(item)) queue.push(item);
      }
    }
  }
  return out;
}

/**
 * Parse a queue payload into a normalised descriptor.
 *
 * Returns null unless the payload actually carries a queue signal — a plain
 * `code: "10605"` without the inner object still counts, because the code alone
 * is the signal the executor keys off.
 */
export function parseQoderQueueInfo(input) {
  const root = typeof input === "string" ? tryParse(input) : input;
  if (!root) return null;

  const objects = walkObjects(root);
  const info = {
    code: undefined,
    subCode: undefined,
    isQueued: undefined,
    modelKey: undefined,
    queueType: undefined,
    queueCount: undefined,
    serviceAvailable: undefined,
    retryAfterSeconds: undefined,
    waitTime: undefined,
  };

  for (const obj of objects) {
    if (info.code === undefined) info.code = toString(obj.code);
    if (info.subCode === undefined) info.subCode = toString(obj.subCode);
    if (info.isQueued === undefined) info.isQueued = toBool(obj.isQueued);
    if (info.modelKey === undefined) info.modelKey = toString(obj.modelKey);
    if (info.queueType === undefined) info.queueType = toString(obj.queueType);
    if (info.queueCount === undefined) info.queueCount = toNumber(obj.queueCount);
    if (info.serviceAvailable === undefined) info.serviceAvailable = toBool(obj.serviceAvailable);
    if (info.retryAfterSeconds === undefined) info.retryAfterSeconds = toNumber(obj.retryAfterSeconds);
    if (info.waitTime === undefined) info.waitTime = toNumber(obj.waitTime);
  }

  const queued =
    info.isQueued === true ||
    info.serviceAvailable === false ||
    info.subCode === "RESOURCE_LIMIT" ||
    info.code === QODER_QUEUE_CODE;

  if (!queued) return null;
  return info;
}

/**
 * True when a parsed response body carries the model-queue signal.
 * Accepts a raw string, a parsed object, or an SSE envelope body.
 */
export function isQoderQueuedBody(input) {
  return parseQoderQueueInfo(input) !== null;
}

/**
 * Delay before the next attempt.
 *
 * Two sources feed this and they are not equally trustworthy:
 *
 * - the **inference refusal** carries waitTime/retryAfterSeconds for the queue
 *   the request actually sits in, so its hint is honoured;
 * - the **queue-status endpoint** has been observed answering
 *   `isQueued:false, retryAfterSeconds:2` while the inference call is still
 *   refused. Replaying every 2s on that hint makes the throttle worse, so a
 *   status-derived delay never drops below STATUS_HINT_FLOOR_MS.
 *
 * Both are clamped into MIN_RETRY_MS..MAX_RETRY_MS.
 */
export function computeQoderQueueDelayMs(info, { fromStatus = false } = {}) {
  const hint = toNumber(info?.retryAfterSeconds) ?? toNumber(info?.waitTime);
  let ms = hint === undefined ? DEFAULT_RETRY_MS : hint * 1000;
  if (fromStatus) ms = Math.max(ms, STATUS_HINT_FLOOR_MS);
  return Math.min(MAX_RETRY_MS, Math.max(MIN_RETRY_MS, ms));
}

/** Total budget for holding a request open while its model is queued. */
export function qoderQueueMaxWaitMs() {
  const raw = Number(process.env[QODER_MODEL_QUEUE_MAX_WAIT_ENV]);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return DEFAULT_MAX_WAIT_MS;
}

/**
 * The queue-status endpoint qodercli polls. Both parameters are required —
 * omitting either answers HTTP 400.
 */
export function qoderQueueStatusUrl(baseUrl, { requestSetId, modelKey, queueType } = {}) {
  const params = new URLSearchParams();
  if (requestSetId) params.set("requestSetId", requestSetId);
  if (modelKey) params.set("modelKey", modelKey);
  if (queueType) params.set("queueType", queueType);
  return `${baseUrl}/algo/api/v2/service/ask/queue/status?${params.toString()}`;
}

/**
 * Parse the queue-status response. Returns null when the body is not the shape
 * we expect, which the caller treats as "status endpoint unusable" and falls
 * back to timed replays.
 */
export function parseQoderQueueStatus(input) {
  const root = typeof input === "string" ? tryParse(input) : input;
  if (!isPlainObject(root)) return null;
  const isQueued = toBool(root.isQueued);
  if (isQueued === undefined) return null;
  return {
    isQueued,
    serviceAvailable: toBool(root.serviceAvailable),
    modelKey: toString(root.modelKey),
    queueType: toString(root.queueType),
    queueCount: toNumber(root.queueCount),
    retryAfterSeconds: toNumber(root.retryAfterSeconds),
    waitTime: toNumber(root.waitTime),
  };
}
