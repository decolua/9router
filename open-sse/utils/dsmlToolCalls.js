// DeepSeek DSML inline tool-call extraction.
//
// DeepSeek-family models sometimes emit tool calls as visible text instead of
// structured tool_call frames. The dialect observed in the wild uses three
// interchangeable delimiters and both closer spellings:
//
//   < | DSML | calls>< | DSML | invoke name="pwsh">
//   < | DSML | parameter name="command" string="true">git --version< / | DSML | parameter>
//   < | DSML | parameter name="timeoutMs" string="false">600000< / | DSML | parameter>
//   < / | DSML | invoke>< / | DSML | calls>
//
// Delimiters: `| DSML |` (spaced ASCII), `|DSML|` (tight ASCII),
// `｜｜DSML｜｜` (full-width U+FF5C). Closers appear as `</|DSML|invoke>` or
// `< / | DSML | invoke>` — the slash may carry surrounding whitespace.
//
// `string="true"` means the parameter body is a literal string; any other value
// (or its absence) means the body is JSON and is parsed when possible.

const DELIM = String.raw`(?:[｜|]{1,2}\s*DSML\s*[｜|]{1,2})`;

// A tag is `<`, optional whitespace, an optional `/`, the delimiter, then the
// tag name. Keeping the slash optional lets one pattern serve open and close.
const tag = (name, extra = "") =>
  String.raw`<\s*/?\s*${DELIM}\s*${name}${extra}\s*>`;

const INVOKE_RE = new RegExp(
  String.raw`<\s*${DELIM}\s*invoke\s+name=["']([^"']+)["']\s*>([\s\S]*?)${tag("invoke")}`,
  "g"
);

const PARAM_RE = new RegExp(
  String.raw`<\s*${DELIM}\s*parameter\s+name=["']([^"']+)["']([^>]*)>([\s\S]*?)(?:${tag("parameter")}|(?=<\s*${DELIM}\s*parameter\s+name=)|(?=${tag("invoke")}))`,
  "g"
);

const CALLS_WRAPPER_RE = new RegExp(String.raw`${tag("calls")}`, "g");

// The whole `<…calls> … <…/calls>` envelope. Removing it as one unit avoids
// leaving behind the whitespace that separates the tags inside it.
const CALLS_BLOCK_RE = new RegExp(
  String.raw`<\s*${DELIM}\s*calls\s*>([\s\S]*?)${tag("calls")}`,
  "g"
);

// True when the text carries a DSML invoke opener. Cheap enough to run on every
// accumulated buffer without allocating a match result.
const HAS_INVOKE_RE = new RegExp(String.raw`<\s*${DELIM}\s*invoke\s`);

// Any complete DSML tag, including the content-free `calls` envelope. The
// envelope arrives before the invoke, so arming on invoke alone would let the
// whitespace that follows it through.
const HAS_ANY_DSML_RE = new RegExp(String.raw`<\s*/?\s*${DELIM}\s*(?:invoke|parameter|calls)(?:\s|>)`);

export function containsDsmlToolCall(text) {
  return typeof text === "string" && HAS_INVOKE_RE.test(text);
}

function coerceParameter(raw, attrs) {
  const body = raw.trim();
  // string="true" is an explicit instruction to keep the body verbatim.
  if (/\bstring\s*=\s*["']true["']/i.test(attrs || "")) return raw;
  try {
    return JSON.parse(body);
  } catch {
    return raw;
  }
}

function parseInvoke(name, body) {
  const args = {};
  PARAM_RE.lastIndex = 0;
  let m;
  while ((m = PARAM_RE.exec(body)) !== null) {
    args[m[1]] = coerceParameter(m[3], m[2]);
  }
  if (Object.keys(args).length === 0) {
    const trimmed = body.trim();
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          Object.assign(args, parsed);
        }
      } catch {
        // Malformed arguments stay empty rather than inventing a shape.
      }
    }
  }
  return { name, arguments: args };
}

/**
 * Split a complete assistant text into visible content plus structured tool
 * calls. Returns the text untouched when it carries no DSML invoke, so callers
 * can run this unconditionally on DeepSeek-family output.
 */
export function parseDsmlToolCalls(text) {
  if (typeof text !== "string" || !containsDsmlToolCall(text)) {
    return { content: text, toolCalls: [] };
  }

  const toolCalls = [];
  // One left-to-right pass so envelope blocks and bare invokes keep document
  // order. Dropping an envelope whole takes its inter-tag whitespace with it.
  const SCAN_RE = new RegExp(
    String.raw`<\s*${DELIM}\s*calls\s*>([\s\S]*?)${tag("calls")}|<\s*${DELIM}\s*invoke\s+name=["']([^"']+)["']\s*>([\s\S]*?)${tag("invoke")}`,
    "g"
  );
  let content = text.replace(SCAN_RE, (_match, envelope, name, body) => {
    if (envelope !== undefined) {
      INVOKE_RE.lastIndex = 0;
      let m;
      while ((m = INVOKE_RE.exec(envelope)) !== null) {
        toolCalls.push(parseInvoke(m[1], m[2]));
      }
    } else {
      toolCalls.push(parseInvoke(name, body));
    }
    return "";
  });

  content = content.replace(CALLS_WRAPPER_RE, "").trim();
  return { content, toolCalls };
}

/**
 * Streaming counterpart. Text arrives in arbitrary chunks, so a DSML block can
 * straddle several of them. The state machine holds back any tail that could
 * still become a tag, releases the rest as visible text, and emits tool calls
 * once an invoke closes.
 *
 * Usage:
 *   const s = createDsmlStreamState();
 *   s.push(delta) -> { text, toolCalls }   // text is safe to forward now
 *   s.flush()     -> { text, toolCalls }   // end of stream
 */
export function createDsmlStreamState() {
  let buffer = "";
  // Sticky once a DSML tag has been seen: the whitespace separating tags arrives
  // in its own push, so a per-push check alone would still leak it.
  let sawDsml = false;

  function drain(isFinal) {
    const toolCalls = [];
    let text = "";

    if (!sawDsml && HAS_ANY_DSML_RE.test(buffer)) sawDsml = true;

    // Strip the envelope tags first: they carry no content, and leaving the
    // opener in place would make it leak into the prose that precedes an invoke.
    buffer = buffer.replace(CALLS_WRAPPER_RE, "");

    // Emit prose ahead of each complete invoke, then drop the invoke. Keeping
    // the leading text is what stops "Running it now." from being swallowed
    // along with the tool block that follows it.
    for (;;) {
      INVOKE_RE.lastIndex = 0;
      const complete = INVOKE_RE.exec(buffer);
      if (!complete) break;
      text += buffer.slice(0, complete.index);
      toolCalls.push(parseInvoke(complete[1], complete[2]));
      buffer = buffer.slice(complete.index + complete[0].length);
    }

    // An invoke whose closer has not arrived yet must be held whole — its body
    // can be arbitrarily long, so a length heuristic would leak it as prose.
    const open = buffer.search(HAS_INVOKE_RE);
    if (open !== -1) {
      if (!isFinal) {
        text += buffer.slice(0, open);
        buffer = buffer.slice(open);
        if (sawDsml && text.trim() === "") text = "";
        return { text, toolCalls };
      }
      // End of stream with the invoke still open: the block is malformed and
      // cannot be turned into a tool call. Releasing it verbatim would put the
      // raw markers in front of the client — the very leak this parser exists
      // to prevent — so drop it.
      text += buffer.slice(0, open);
      buffer = "";
    }

    // Otherwise hold back only a tail that could still grow into a tag.
    const lt = buffer.lastIndexOf("<");
    if (lt === -1 || isFinal) {
      text += buffer;
      buffer = "";
    } else {
      const tail = buffer.slice(lt);
      // Longer than any possible opener ⇒ it can never become a tag.
      if (tail.length > 64) {
        text += buffer;
        buffer = "";
      } else {
        text += buffer.slice(0, lt);
        buffer = tail;
      }
    }

    // Whitespace left between removed tags is not client-visible content.
    if (sawDsml && text.trim() === "") text = "";
    if (isFinal) sawDsml = false;
    return { text, toolCalls };
  }

  return {
    push(chunk) {
      if (typeof chunk !== "string" || !chunk) return { text: "", toolCalls: [] };
      buffer += chunk;
      return drain(false);
    },
    flush() {
      return drain(true);
    },
  };
}
