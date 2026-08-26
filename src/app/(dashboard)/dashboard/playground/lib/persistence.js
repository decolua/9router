const VERSION = 1;

export const PLAYGROUND_PERSISTENCE_LIMITS = Object.freeze({
  sessions: 20,
  messagesPerSession: 100,
  presets: 20,
  stopSequences: 4,
  stopSequenceCharacters: 256,
  images: 4,
  imageBytes: 2 * 1024 * 1024,
  serializedBytes: 2 * 1024 * 1024,
});

export const PLAYGROUND_PERSISTENCE_KEYS = Object.freeze({
  sessions: "9router:playground:v1:sessions",
  presetsConfig: "9router:playground:v1:presets-config",
  selection: "9router:playground:v1:selection",
  draft: "9router:playground:v1:draft",
});

const SAFE_WARNING = "Local storage is full; changes remain in this browser session only.";
const forbiddenFieldPattern = /^(authorization|cookie|dataurl|providerspecificdata|api[-_]?key|access[-_]?token|refresh[-_]?token|password|headers?)$/i;
const forbiddenValuePattern = /\b(?:bearer|api[_-]?key|access[_-]?token|refresh[_-]?token)\b/i;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value === "string") return forbiddenValuePattern.test(value) ? "[redacted]" : value;
  if (!isRecord(value)) return value;

  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !forbiddenFieldPattern.test(key))
    .map(([key, entry]) => [key, sanitize(entry)]));
}

function trimStopSequences(config) {
  if (!isRecord(config)) return {};
  const sanitized = sanitize(config);
  if (!Array.isArray(sanitized.stop)) return sanitized;

  return {
    ...sanitized,
    stop: sanitized.stop
      .filter((value) => typeof value === "string")
      .slice(0, PLAYGROUND_PERSISTENCE_LIMITS.stopSequences)
      .map((value) => value.slice(0, PLAYGROUND_PERSISTENCE_LIMITS.stopSequenceCharacters)),
  };
}

function normalizeAttachment(attachment) {
  if (!isRecord(attachment) || attachment.size > PLAYGROUND_PERSISTENCE_LIMITS.imageBytes) return null;
  return sanitize(attachment);
}

function normalizeMessage(message) {
  if (!isRecord(message)) return sanitize(message);
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  return {
    ...sanitize(message),
    attachments: attachments
      .map(normalizeAttachment)
      .filter(Boolean)
      .slice(0, PLAYGROUND_PERSISTENCE_LIMITS.images),
  };
}

function normalizeSession(session) {
  if (!isRecord(session)) return null;
  const messages = Array.isArray(session.messages) ? session.messages : [];
  return {
    ...sanitize(session),
    messages: messages.slice(-PLAYGROUND_PERSISTENCE_LIMITS.messagesPerSession).map(normalizeMessage),
  };
}

function normalizeState(state) {
  const input = isRecord(state) ? state : {};
  return {
    sessions: (Array.isArray(input.sessions) ? input.sessions : [])
      .map(normalizeSession)
      .filter(Boolean)
      .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))
      .slice(0, PLAYGROUND_PERSISTENCE_LIMITS.sessions),
    presets: (Array.isArray(input.presets) ? input.presets : [])
      .filter(isRecord)
      .slice(0, PLAYGROUND_PERSISTENCE_LIMITS.presets)
      .map((preset) => ({ ...sanitize(preset), config: trimStopSequences(preset.config) })),
    config: trimStopSequences(input.config),
    selection: sanitize(isRecord(input.selection) ? input.selection : {}),
    draft: typeof input.draft === "string" ? input.draft : "",
  };
}

function encodeNamespaces(state) {
  return {
    [PLAYGROUND_PERSISTENCE_KEYS.sessions]: JSON.stringify({ version: VERSION, value: state.sessions }),
    [PLAYGROUND_PERSISTENCE_KEYS.presetsConfig]: JSON.stringify({ version: VERSION, value: { presets: state.presets, config: state.config } }),
    [PLAYGROUND_PERSISTENCE_KEYS.selection]: JSON.stringify({ version: VERSION, value: state.selection }),
    [PLAYGROUND_PERSISTENCE_KEYS.draft]: JSON.stringify({ version: VERSION, value: state.draft }),
  };
}

function boundSerializedState(state) {
  const bounded = { ...state, sessions: [...state.sessions] };
  while (bounded.sessions.length > 0 && byteLength(Object.values(encodeNamespaces(bounded)).join("")) > PLAYGROUND_PERSISTENCE_LIMITS.serializedBytes) {
    bounded.sessions.pop();
  }
  return bounded;
}

function decodeNamespace(storage, key, fallback) {
  const raw = storage?.getItem(key);
  if (!raw) return fallback;

  try {
    const envelope = JSON.parse(raw);
    if (!isRecord(envelope) || envelope.version !== VERSION || !("value" in envelope)) throw new Error("Invalid persistence envelope");
    return envelope.value;
  } catch {
    try {
      storage?.removeItem(key);
    } catch {
      // Storage can be unavailable in private or restricted browser contexts.
    }
    return fallback;
  }
}

function isQuotaError(error) {
  return error?.name === "QuotaExceededError";
}

function writeNamespaces(storage, values) {
  for (const [key, value] of Object.entries(values)) storage.setItem(key, value);
}

export function createPlaygroundPersistence(storage = globalThis.localStorage) {
  return {
    load() {
      const sessions = decodeNamespace(storage, PLAYGROUND_PERSISTENCE_KEYS.sessions, []);
      const presetsConfig = decodeNamespace(storage, PLAYGROUND_PERSISTENCE_KEYS.presetsConfig, {});
      const selection = decodeNamespace(storage, PLAYGROUND_PERSISTENCE_KEYS.selection, {});
      const draft = decodeNamespace(storage, PLAYGROUND_PERSISTENCE_KEYS.draft, "");
      return normalizeState({
        sessions,
        presets: isRecord(presetsConfig) ? presetsConfig.presets : [],
        config: isRecord(presetsConfig) ? presetsConfig.config : {},
        selection,
        draft,
      });
    },

    save(state) {
      const bounded = boundSerializedState(normalizeState(state));
      try {
        writeNamespaces(storage, encodeNamespaces(bounded));
        return { persisted: true, memoryOnly: false, warning: null, evictedSessionIds: [] };
      } catch (error) {
        if (!isQuotaError(error)) return { persisted: false, memoryOnly: true, warning: SAFE_WARNING, evictedSessionIds: [] };
      }

      const evicted = [...bounded.sessions].sort((left, right) => String(left.updatedAt || "").localeCompare(String(right.updatedAt || "")))[0];
      if (!evicted) return { persisted: false, memoryOnly: true, warning: SAFE_WARNING, evictedSessionIds: [] };

      const retryState = { ...bounded, sessions: bounded.sessions.filter((session) => session.id !== evicted.id) };
      try {
        writeNamespaces(storage, encodeNamespaces(retryState));
        return { persisted: true, memoryOnly: false, warning: null, evictedSessionIds: [evicted.id] };
      } catch {
        return { persisted: false, memoryOnly: true, warning: SAFE_WARNING, evictedSessionIds: [evicted.id] };
      }
    },
  };
}
