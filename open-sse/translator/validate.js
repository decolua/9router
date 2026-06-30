// Outbound payload validation gate.
// Runs right before executor.execute() in chatCore. Catches:
//  - Required-field violations (model / messages / max_tokens / contents / input / ...)
//  - Shape violations per target format (e.g. assistant with no content AND no tool_calls,
//    gemini role outside {user, model}, malformed tool schema).
//  - Leftover internal-only underscore keys (_toolNameMap, _clientSessionId) that must
//    not leak upstream. Other underscore-prefixed keys are stripped defensively
//    but only the known ones fail validation by name.
//
// Strict by default; chatCore honors runtimeConfig.VALIDATE_OUTBOUND to disable
// the gate in an emergency (does not change which keys get stripped).
import { FORMATS } from "./formats.js";
import {
  ROLE,
  GEMINI_ROLE,
  OPENAI_BLOCK,
  CLAUDE_BLOCK,
} from "./schema/index.js";

// Internal-only keys that must NEVER be sent to an upstream provider.
// Detection of these fails validation; stripping always removes them.
export const INTERNAL_KEYS = Object.freeze([
  "_toolNameMap",
  "_clientSessionId",
]);

// Keys that may legitimately start with "_" in provider payloads (none today,
// but keep a list so future additions are explicit). Anything else starting with
// "_" is treated as suspicious and stripped silently.
const ALLOWED_UNDERSCORE_KEYS = new Set();

const OPENAI_ROLES = new Set([
  ROLE.USER,
  ROLE.ASSISTANT,
  ROLE.TOOL,
  ROLE.SYSTEM,
  ROLE.DEVELOPER,
]);
const CLAUDE_ROLES = new Set([ROLE.USER, ROLE.ASSISTANT]);
const GEMINI_ROLES = new Set([GEMINI_ROLE.USER, GEMINI_ROLE.MODEL]);
const CLAUDE_BLOCK_TYPES = new Set([
  ...Object.values(CLAUDE_BLOCK),
  // Extended Claude-compatible blocks emitted by some clients / tool systems.
  "server_tool_use",
  "web_search_tool_result",
  "mcp_tool_use",
  "mcp_tool_result",
  "search_result",
  "code_execution_tool_result",
]);
const OPENAI_CONTENT_TYPES = new Set([
  OPENAI_BLOCK.TEXT,
  OPENAI_BLOCK.IMAGE_URL,
  OPENAI_BLOCK.IMAGE,
  OPENAI_BLOCK.INPUT_AUDIO,
  OPENAI_BLOCK.AUDIO_URL,
  OPENAI_BLOCK.FILE,
]);

function pushError(errors, path, message) {
  errors.push({ path, message });
}

// Strip known internal keys (always) and any other underscore-prefixed keys
// (silently — those don't fail validation, they just get removed).
// Mutates the body in place and returns it for convenience.
export function stripInternalKeys(body) {
  if (!body || typeof body !== "object") return body;
  for (const k of Object.keys(body)) {
    if (k.startsWith("_") && !ALLOWED_UNDERSCORE_KEYS.has(k)) {
      delete body[k];
    }
  }
  return body;
}

// ---- Format-specific validators -------------------------------------------------

function validateOpenAI(body, errors) {
  if (
    body.model === null ||
    body.model === undefined ||
    (typeof body.model !== "string" && typeof body.model !== "object")
  ) {
    pushError(errors, "model", "model is required for openai target");
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    pushError(
      errors,
      "messages",
      "messages[] is required and must be non-empty for openai target",
    );
    return;
  }
  body.messages.forEach((msg, i) => {
    const p = `messages[${i}]`;
    if (!msg || typeof msg !== "object") {
      pushError(errors, p, "message must be an object");
      return;
    }
    const m = msg;
    if (typeof m.role !== "string" || m.role.length === 0 || !OPENAI_ROLES.has(m.role)) {
      pushError(
        errors,
        `${p}.role`,
        `role must be one of ${[...OPENAI_ROLES].join("|")}`,
      );
    }
    if (m.role === ROLE.ASSISTANT) {
      // Assistant must have content or tool_calls.
      const hasContent =
        m.content !== undefined &&
        !(typeof m.content === "string" && m.content === "");
      const hasToolCalls =
        Array.isArray(m.tool_calls) && m.tool_calls.length > 0;
      if (!hasContent && !hasToolCalls) {
        pushError(
          errors,
          `${p}.content`,
          "assistant message must have content or tool_calls",
        );
      }
    } else if (m.role === ROLE.TOOL) {
      if (m.tool_call_id === null || m.tool_call_id === undefined || typeof m.tool_call_id !== "string") {
        pushError(
          errors,
          `${p}.tool_call_id`,
          "tool message requires string tool_call_id",
        );
      }
    } else {
      if (m.content === undefined) {
        pushError(
          errors,
          `${p}.content`,
          `${m.role} message requires content`,
        );
      }
    }
    // Array content block type check
    if (Array.isArray(m.content)) {
      m.content.forEach((block, j) => {
        if (!block || typeof block !== "object") return;
        const b = block;
        if (b.type && !OPENAI_CONTENT_TYPES.has(b.type)) {
          pushError(
            errors,
            `${p}.content[${j}].type`,
            `unsupported openai content type "${b.type}"`,
          );
        }
      });
    }
  });
  if (Array.isArray(body.tools)) {
    body.tools.forEach((tool, i) => {
      const p = `tools[${i}]`;
      if (!tool || typeof tool !== "object") {
        pushError(errors, p, "tool must be an object");
        return;
      }
      const t = tool;
      if (t.type === OPENAI_BLOCK.FUNCTION) {
        if (!t.function || typeof t.function !== "object") {
          pushError(
            errors,
            `${p}.function`,
            "function tool requires .function object",
          );
        } else {
          const fn = t.function;
          if (typeof fn.name !== "string" || fn.name.length === 0) {
            pushError(
              errors,
              `${p}.function.name`,
              "function tool requires .function.name string",
            );
          }
          // parameters must be a plain object (JSON Schema) — null/undefined allowed
          if (
            fn.parameters != null &&
            typeof fn.parameters !== "object"
          ) {
            pushError(
              errors,
              `${p}.function.parameters`,
              "function tool .function.parameters must be an object",
            );
          }
        }
      }
    });
  }
}

function validateClaude(body, errors) {
  if (
    body.model === null ||
    body.model === undefined ||
    (typeof body.model !== "string" && typeof body.model !== "object")
  ) {
    pushError(errors, "model", "model is required for claude target");
  }
  // max_tokens is mandatory for Anthropic Messages API.
  if (
    body.max_tokens === null ||
    body.max_tokens === undefined ||
    (typeof body.max_tokens !== "number" && typeof body.max_tokens !== "string")
  ) {
    pushError(errors, "max_tokens", "max_tokens is required for claude target");
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    pushError(
      errors,
      "messages",
      "messages[] is required and must be non-empty for claude target",
    );
  } else {
    body.messages.forEach((msg, i) => {
      const p = `messages[${i}]`;
      if (!msg || typeof msg !== "object") {
        pushError(errors, p, "message must be an object");
        return;
      }
      const m = msg;
      if (typeof m.role !== "string" || m.role.length === 0 || !CLAUDE_ROLES.has(m.role)) {
        pushError(
          errors,
          `${p}.role`,
          `role must be one of ${[...CLAUDE_ROLES].join("|")}`,
        );
      }
      // content can be a string or an array of blocks
      if (Array.isArray(m.content)) {
        m.content.forEach((block, j) => {
          if (!block || typeof block !== "object") return;
          const b = block;
          if (b.type && !CLAUDE_BLOCK_TYPES.has(b.type)) {
            pushError(
              errors,
              `${p}.content[${j}].type`,
              `unsupported claude content type "${b.type}"`,
            );
          }
        });
      }
    });
  }
  // system: string OR array of {type:"text", text:string}
  if (body.system != null) {
    if (typeof body.system !== "string" && !Array.isArray(body.system)) {
      pushError(
        errors,
        "system",
        "system must be string or array of text blocks",
      );
    } else if (Array.isArray(body.system)) {
      body.system.forEach((block, i) => {
        if (
          !block ||
          typeof block !== "object" ||
          (block.type && block.type !== "text")
        ) {
          pushError(
            errors,
            `system[${i}]`,
            'system block must be {type:"text", text:string}',
          );
        }
      });
    }
  }
  if (Array.isArray(body.tools)) {
    body.tools.forEach((tool, i) => {
      const p = `tools[${i}]`;
      if (!tool || typeof tool !== "object") {
        pushError(errors, p, "tool must be an object");
        return;
      }
      const t = tool;
      if (typeof t.name !== "string" || t.name.length === 0) {
        pushError(errors, `${p}.name`, "claude tool requires .name string");
      }
      if (t.input_schema != null && typeof t.input_schema !== "object") {
        pushError(
          errors,
          `${p}.input_schema`,
          "input_schema must be an object",
        );
      }
    });
  }
}

function validateGemini(body, errors) {
  if (
    body.model === null ||
    body.model === undefined ||
    (typeof body.model !== "string" && typeof body.model !== "object")
  ) {
    pushError(errors, "model", "model is required for gemini/vertex target");
  }
  // Cloud Code envelopes (Gemini-CLI / Antigravity) nest the actual Gemini
  // payload under body.request, while model stays at the top level. Resolve
  // the payload root for contents/parts validation without mutating body.
  const root =
    body.request && typeof body.request === "object"
      ? body.request
      : body;
  const contentsPath = root === body.request ? "request.contents" : "contents";
  if (!Array.isArray(root.contents) || root.contents.length === 0) {
    pushError(
      errors,
      contentsPath,
      "contents[] is required and must be non-empty for gemini/vertex target",
    );
    return;
  }
  root.contents.forEach((msg, i) => {
    const p = `${contentsPath}[${i}]`;
    if (!msg || typeof msg !== "object") {
      pushError(errors, p, "content must be an object");
      return;
    }
    const m = msg;
    if (typeof m.role !== "string" || m.role.length === 0 || !GEMINI_ROLES.has(m.role)) {
      pushError(
        errors,
        `${p}.role`,
        `role must be one of ${[...GEMINI_ROLES].join("|")}`,
      );
    }
    if (!Array.isArray(m.parts) || m.parts.length === 0) {
      pushError(
        errors,
        `${p}.parts`,
        "gemini content requires non-empty parts[]",
      );
    }
  });
}

function validateOpenAIResponses(body, errors) {
  if (
    body.model === null ||
    body.model === undefined ||
    (typeof body.model !== "string" && typeof body.model !== "object")
  ) {
    pushError(errors, "model", "model is required for openai-responses target");
  }
  const hasInput = Array.isArray(body.input) && body.input.length > 0;
  const hasMessages = Array.isArray(body.messages) && body.messages.length > 0;
  if (!hasInput && !hasMessages) {
    pushError(
      errors,
      "input",
      "openai-responses target requires input[] or messages[]",
    );
  }
  if (body.tools != null) {
    if (!Array.isArray(body.tools)) {
      pushError(errors, "tools", "tools must be an array");
    } else {
      body.tools.forEach((tool, i) => {
        const p = `tools[${i}]`;
        if (!tool || typeof tool !== "object") {
          pushError(errors, p, "tool must be an object");
          return;
        }
        const t = tool;
        if (
          t.type === OPENAI_BLOCK.FUNCTION &&
          (!t.function || typeof t.function !== "object")
        ) {
          pushError(
            errors,
            `${p}.function`,
            "function tool requires .function object",
          );
        }
      });
    }
  }
}

// Validate the translated body that is about to be dispatched upstream.
// Returns { ok, errors }. errors[] is empty on success.
// Caller is expected to short-circuit (return 400 to the client) on ok=false.
export function validateOutboundPayload(targetFormat, body) {
  const errors = [];
  if (!body || typeof body !== "object") {
    return {
      ok: false,
      errors: [
        { path: "<root>", message: "outbound body must be a non-null object" },
      ],
    };
  }
  const b = body;
  // 1. Internal key leak detection (always fails validation by name).
  for (const k of Object.keys(b)) {
    if (INTERNAL_KEYS.includes(k)) {
      pushError(errors, k, `internal key "${k}" must not leak upstream`);
    }
  }
  // 2. Format-specific shape checks.
  switch (targetFormat) {
    case FORMATS.OPENAI:
    case FORMATS.CODEX:
    case FORMATS.OLLAMA:
    case FORMATS.CURSOR:
    case FORMATS.COMMANDCODE:
    case FORMATS.KIRO:
      // Kiro / Codex / Ollama / Cursor / Commandcode receive OpenAI-shaped bodies
      // from the translator pipeline.
      validateOpenAI(b, errors);
      break;
    case FORMATS.CLAUDE:
      validateClaude(b, errors);
      break;
    case FORMATS.GEMINI:
    case FORMATS.GEMINI_CLI:
    case FORMATS.ANTIGRAVITY:
    case FORMATS.VERTEX:
      validateGemini(b, errors);
      break;
    case FORMATS.OPENAI_RESPONSES:
    case FORMATS.OPENAI_RESPONSE:
      validateOpenAIResponses(b, errors);
      break;
    default:
      // Unknown target — at least require a model so we don't dispatch an
      // empty object upstream.
      if (b.model === null || b.model === undefined) {
        pushError(errors, "model", "model is required (unknown target format)");
      }
  }
  return { ok: errors.length === 0, errors };
}
