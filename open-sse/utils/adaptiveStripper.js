const BLOCKLIST_CACHE = new Map();

const FIELD_REJECTION_PATTERNS = [
  /messages?\.\d+\s*:\s*property\s+['"`]([^'"`]+)['"`]\s+unsupported/gi,
  /messages?\.\d+\s*:\s*property\s+['"`]([^'"`]+)['"`]\s+(?:is|was)\s+unsupported/gi,
  /(?:^|[, ])property\s+['"`]([^'"`]+)['"`]\s+(?:is|was)\s+unsupported/gi,
  /unsupported\s+field\s+['"`]([^'"`]+)['"`]/i,
  /['"`]([^'"`]+)['"`]\s+is\s+not\s+recognized/i,
  /property\s+['"`]([^'"`]+)['"`]\s+is\s+not\s+supported/i,
  /Field\s+['"`]([^'"`]+)['"`]\s+(?:is|must|should)/i,
  /Unsupported parameter\(s\): [`'"]([^`'"]+)[`'"]/i,
  /\[[^\]]*['"`]([a-zA-Z_][a-zA-Z0-9_]+)['"`][^\]]*(?:is|was|must)\s+unsupported/gi,
];

const COMPILED_PATTERNS = FIELD_REJECTION_PATTERNS.map((p) => new RegExp(p.source, "g"));

export function getBlocklistKey(provider, model) {
  return `${provider}::${model}`;
}

export function getRejectedFields(provider, model) {
  const key = getBlocklistKey(provider, model);
  return BLOCKLIST_CACHE.get(key) || new Set();
}

export function addRejectedFields(provider, model, fields) {
  const key = getBlocklistKey(provider, model);
  const set = BLOCKLIST_CACHE.get(key) || new Set();
  for (const field of fields) {
    const normalized = field.toLowerCase().trim();
    if (normalized && /^[a-z_][a-z0-9_]*$/.test(normalized)) {
      set.add(normalized);
    }
  }
  BLOCKLIST_CACHE.set(key, set);
  return set;
}

export function stripRejectedFields(body, provider, model) {
  const rejected = getRejectedFields(provider, model);
  if (!body?.messages || !rejected.size) return body;
  let changed = false;
  const newBody = { ...body };
  newBody.messages = newBody.messages.map((msg) => {
    if (!msg || typeof msg !== "object") return msg;
    const newMsg = { ...msg };
    for (const key of rejected) {
      if (key in newMsg) {
        delete newMsg[key];
        changed = true;
      }
    }
    return newMsg;
  });


  return changed ? newBody : null;
}

export function extractRejectedFieldNames(message) {
  if (!message || typeof message !== "string") return [];
  const fields = new Set();
  for (const pattern of COMPILED_PATTERNS) {
    for (const m of message.matchAll(pattern)) {
      if (m[1]) fields.add(m[1]);
    }
  }
  return [...fields];
}

export function extractRejectedFieldNamesFromError(responseBody) {
  if (typeof responseBody === "string") {
    const fields = extractRejectedFieldNames(responseBody);
    return fields;
  }
  if (typeof responseBody === "object" && responseBody !== null) {
    const details = responseBody.error?.detail;
    if (Array.isArray(details)) {
      const fields = [];
      for (const d of details) {
        if (d?.type === "extra_forbidden" && Array.isArray(d.loc)) {
          const last = d.loc[d.loc.length - 1];
          if (typeof last === "string" && /^[a-z_][a-z0-9_]*$/.test(last)) {
            fields.push(last);
          }
        }
      }
      return fields;
    }
    if (responseBody.error?.message) {
      const fields = extractRejectedFieldNames(responseBody.error.message);
      return fields;
    }
  }
  return [];
}
