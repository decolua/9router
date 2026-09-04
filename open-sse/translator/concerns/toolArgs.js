// Shared helpers for OpenAI-shaped → Claude streaming translators.
// Used by both response/openai-to-claude.js and response/kiro-to-claude.js
// so the two direct Claude routes don't drift.

// Repair duplicated / repeated JSON objects emitted by upstream proxies or
// cumulative streams: exact-half repeats ("{...}" + "{...}") and concatenated
// objects ("{...}{...}"). Returns the original string when nothing matches.
export function repairDuplicatedJsonArguments(raw) {
  if (typeof raw !== "string" || raw.length < 4) return raw;
  try {
    JSON.parse(raw);
    return raw;
  } catch {}

  const len = raw.length;
  if (len % 2 === 0) {
    const half = raw.slice(0, len / 2);
    if (half === raw.slice(len / 2)) {
      try {
        JSON.parse(half);
        return half;
      } catch {}
    }
  }

  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === "\"") {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            const candidate = trimmed.slice(0, i + 1);
            try {
              JSON.parse(candidate);
              const remainder = trimmed.slice(i + 1).trim();
              if (remainder.startsWith("{")) {
                return candidate;
              }
            } catch {
              break;
            }
          }
        }
      }
    }
  }

  return raw;
}

// Append streamed tool-call arguments. Upstreams stream either diff chunks
// (append) or cumulative snapshots (full string starting with what we have);
// repeated full payloads (proxy resends the whole args on the finish chunk)
// must not double the buffer.
export function appendToolArgs(current, incoming) {
  if (!incoming) return current || "";
  if (!current) return incoming;
  if (incoming === current) return current;
  if (incoming.startsWith(current)) return incoming;
  return current + incoming;
}
