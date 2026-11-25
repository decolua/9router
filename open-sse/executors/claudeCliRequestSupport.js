/**
 * What a request can ask of the Claude Code CLI, and what it cannot.
 *
 * The CLI is a coding agent, not the Messages API: it has no flag for
 * temperature, for a token ceiling, for stop sequences, or for forcing a
 * particular tool. Those fields used to be read off the body and dropped
 * without a word, so a caller that asked for JSON, or for a specific tool, or
 * for one short answer, got something else and no indication why.
 *
 * Two kinds of gap, treated differently:
 *
 *   - A field whose absence changes the shape of the answer the caller
 *     promised their own user — a forced tool, a JSON schema, several
 *     completions — is refused. Answering anyway would be answering a
 *     different question.
 *   - A field that only tunes an answer we can still give — temperature, a
 *     token ceiling — is ignored, and named in the log so the difference is
 *     visible when the output is not what someone expected.
 *
 * `tool_choice: "none"` is neither: it is honoured, by not advertising the
 * tools at all.
 *
 * `response_format` used to be in the first group, on the premise that the CLI
 * has no structured-output mode. It has one — `--json-schema` — so it is carried
 * now, and what is refused is only what the flag cannot take.
 */

import { CLAUDE_CLI_JSON_SCHEMA_LIMITS, CLAUDE_CLI_MAX_JSON_SCHEMA_CHARS } from "../config/claudeCli.js";

/**
 * Fields the CLI will not act on, each for a measured reason (2.1.280):
 *
 *   temperature/top_p/top_k  the request fails outright — "temperature may only
 *                            be set to 1 when thinking is enabled", and Claude
 *                            Code runs with thinking on.
 *   seed/penalties/logprobs  no equivalent in Anthropic's API at all.
 *
 * They are named in the log rather than refused, because none of them changes
 * what the answer *is* — only how it would have been shaped.
 */
const IGNORED_FIELDS = [
  // One turn per request, as the Hermes plugin does and as this endpoint's
  // semantics require: an agent loop belongs to the client. It is also what
  // lets the cache relay admit exactly one model call.
  "max_turns",
  "temperature",
  "top_p",
  "top_k",
  "seed",
  "presence_penalty",
  "frequency_penalty",
  "logprobs",
  "logit_bias",
];

/**
 * A ceiling on the answer, in the one form the CLI accepts.
 *
 * Not through CLAUDE_CODE_EXTRA_BODY — measured there with a limit of 32, the
 * model produced 128 output tokens and the CLI then reported an error with no
 * content at all. `CLAUDE_CODE_MAX_OUTPUT_TOKENS` is a different channel and it
 * does bound the answer. Measured on 2.1.281, same prompt:
 *
 *   unset  476 output tokens, end_turn,      691 chars
 *   1024   882 output tokens, end_turn,     1547 chars
 *   128    512 output tokens, stop_sequence, 155 chars, is_error
 *   64     256 output tokens, stop_sequence, 154 chars, is_error
 *
 * So it is a ceiling the CLI applies loosely rather than the exact number, and
 * when it binds the turn is flagged as an error even though the content is
 * there. Both are handled: the value is passed, and a bound turn is delivered
 * as a completion that stopped early rather than as a failure. Approximate
 * beats ignored — a caller that asked for a short answer was getting whatever
 * the model felt like writing, and paying for it.
 *
 * @returns {string} the value for the child env, or "" when none was asked for
 */
export function outputTokenCeiling(body = {}) {
  const asked = body.max_tokens ?? body.max_completion_tokens;
  const limit = Number(asked);
  if (!Number.isInteger(limit) || limit < 1) return "";
  return String(limit);
}

/**
 * Generation fields the CLI does carry, in the shape the upstream body takes.
 *
 * Only stop sequences survive the trip. The CLI has no flag for them, but it
 * applies CLAUDE_CODE_EXTRA_BODY to the request it sends — verified on 2.1.280,
 * where a stop sequence ended the answer where the caller asked. Everything
 * else that could go here either fails the request or is not honoured; see
 * IGNORED_FIELDS.
 */
export function generationExtraBody(body = {}) {
  // OpenAI sends a string or a list; Claude takes a list either way.
  const stop = body.stop_sequences ?? body.stop;
  const stopList = typeof stop === "string" ? [stop] : Array.isArray(stop) ? stop : [];
  const stops = stopList.filter((entry) => typeof entry === "string" && entry.length > 0);
  return stops.length ? { stop_sequences: stops } : null;
}

/** A `json_object` request asks for an object and nothing about its shape. */
const JSON_OBJECT_SCHEMA = JSON.stringify({ type: "object" });

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const SCHEMA_REFERENCE_KEYWORDS = new Set(["$ref", "$dynamicRef", "$recursiveRef"]);

/**
 * Why a schema is too elaborate to hand to the CLI, or null.
 *
 * Bounded by the limits, not by the request. Every value met is counted against
 * `maxValues` — a plain number included, which no other limit would see — before
 * anything is done with it, and an array is walked by index rather than having
 * its keys listed first. Without that, a 10 MB array of ones cost 555 MB of heap
 * (a fatal out-of-memory under a 256 MB cap) before the length check refused it.
 * Iterative, so depth cannot overflow the stack.
 *
 * A `$ref` is counted wherever a string-valued one sits, with no exemption for
 * keys that look like a map of property names: that exemption is what let the
 * ones under `dependencies` through. A string-valued `$ref` under a real
 * property map is an invalid schema the CLI's validator rejects outright, so
 * counting it costs nothing.
 * @see CLAUDE_CLI_JSON_SCHEMA_LIMITS for why these are the things bounded.
 */
function schemaComplexityProblem(root) {
  const { maxNodes, maxDepth, maxRefs, maxValues } = CLAUDE_CLI_JSON_SCHEMA_LIMITS;
  const pending = [{ node: root, depth: 0 }];
  let nodes = 0;
  let values = 1; // the root
  let refs = 0;

  // One value met inside a container: why to stop, or null.
  const take = (key, child, depth) => {
    values += 1;
    if (values > maxValues) return `it has more than ${maxValues} values`;
    if (typeof child === "string" && SCHEMA_REFERENCE_KEYWORDS.has(key)) {
      refs += 1;
      if (refs > maxRefs) return `it uses more than ${maxRefs} $ref references`;
    }
    if (child !== null && typeof child === "object") pending.push({ node: child, depth: depth + 1 });
    return null;
  };

  while (pending.length) {
    const { node, depth } = pending.pop();
    nodes += 1;
    if (nodes > maxNodes) return `it has more than ${maxNodes} nodes`;
    if (depth > maxDepth) return `it nests deeper than ${maxDepth} levels`;
    let problem = null;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length && !problem; i += 1) problem = take(i, node[i], depth);
    } else {
      for (const key in node) {
        if (!Object.hasOwn(node, key)) continue;
        problem = take(key, node[key], depth);
        if (problem) break;
      }
    }
    if (problem) return problem;
  }
  return null;
}

function invalidFormat(reason) {
  return {
    refusal: {
      code: "invalid_response_format",
      message: `Claude Code CLI cannot use this response_format: ${reason}`,
    },
  };
}

/**
 * What `response_format` asks of the CLI, settled in one place so the refusal
 * and the flag can never disagree about a request.
 *
 * The CLI does take a schema: `claude -p --json-schema <schema>` makes it answer
 * through a tool whose input is validated against it. OpenAI's `json_schema`
 * wraps the schema (`{ json_schema: { name, strict, schema } }`); the CLI takes
 * the schema bare. `json_object` has no schema, so it becomes the loosest one
 * that still forces an object.
 *
 * @returns {{ schema: string } | { refusal: { code: string, message: string } } | null}
 *   null when the request asked for no particular format.
 */
function resolveStructuredOutput(body) {
  const format = body.response_format;
  const formatType = typeof format === "string" ? format : format?.type;
  if (formatType === "json_object") return { schema: JSON_OBJECT_SCHEMA };
  if (formatType !== "json_schema") return null;

  const schema = format?.json_schema?.schema;
  // The answer goes through a tool, and a tool's input is always an object.
  if (!isPlainObject(schema) || schema.type !== "object") {
    return invalidFormat("response_format.json_schema.schema must be an object whose top level "
      + "is `{ \"type\": \"object\", ... }`, because the CLI answers through a tool and a "
      + "tool's input is always an object.");
  }
  // Before anything serializes it: a schema nested tens of thousands of levels
  // deep makes JSON.stringify throw out of execute(), and one built to be slow to
  // validate costs the child far more than its size suggests.
  const problem = schemaComplexityProblem(schema);
  if (problem) {
    return {
      refusal: {
        code: "response_format_too_large",
        message: `Claude Code CLI validates the schema inside its own process, so it cannot be `
          + `elaborate: ${problem}. Send a simpler schema, or use a provider backed by the API.`,
      },
    };
  }
  // One line, no raw control characters: JSON.stringify guarantees both.
  const serialized = JSON.stringify(schema);
  if (serialized.length > CLAUDE_CLI_MAX_JSON_SCHEMA_CHARS) {
    return {
      refusal: {
        code: "response_format_too_large",
        message: `Claude Code CLI takes the schema as a command-line argument, which caps it at `
          + `${CLAUDE_CLI_MAX_JSON_SCHEMA_CHARS} characters; this one is ${serialized.length}. `
          + "Send a smaller schema, or use a provider backed by the API.",
      },
    };
  }
  return { schema: serialized };
}

/**
 * The value for `--json-schema`, or null when the request asked for no
 * particular format — or asked for one {@link unsupportedRequestFeature}
 * refuses, which never gets this far.
 * @returns {string | null}
 */
export function structuredOutputSchema(body = {}) {
  const resolved = resolveStructuredOutput(body);
  return resolved && Object.hasOwn(resolved, "schema") ? resolved.schema : null;
}

function toolChoiceKind(toolChoice) {
  if (toolChoice === undefined || toolChoice === null) return "auto";
  if (typeof toolChoice === "string") {
    if (toolChoice === "none") return "none";
    if (toolChoice === "auto") return "auto";
    // OpenAI "required", Claude "any": the model must call something.
    return "forced";
  }
  if (typeof toolChoice === "object") {
    const type = String(toolChoice.type || "");
    if (type === "none") return "none";
    if (type === "auto") return "auto";
    // { type: "tool", name } / { type: "function", function: { name } } / "any"
    return "forced";
  }
  return "auto";
}

/**
 * The reason this request cannot be served, or null.
 * @returns {{ message: string, code: string } | null}
 */
export function unsupportedRequestFeature(body = {}) {
  const hasTools = Array.isArray(body.tools) && body.tools.length > 0;

  if (hasTools && toolChoiceKind(body.tool_choice) === "forced") {
    return {
      code: "unsupported_tool_choice",
      message: "Claude Code CLI cannot be made to call a particular tool: it is asked, "
        + "not instructed, and there is no flag for forcing one. Send tool_choice "
        + "\"auto\" (or omit it) and let the model decide, or use a provider backed by "
        + "the API for this request.",
    };
  }

  const structured = resolveStructuredOutput(body);
  if (structured?.refusal) return structured.refusal;
  // The CLI answers through a tool of its own, and the caller's tools would
  // compete with it for the one turn there is. How the two interact was not
  // measured, so the combination is not offered rather than guessed at.
  if (structured && hasTools && toolsAreWanted(body)) {
    return {
      code: "unsupported_response_format_with_tools",
      message: "Claude Code CLI can return structured output or propose your tools in one "
        + "request, not both. Drop response_format, or send tool_choice \"none\" (or no tools), "
        + "or use a provider backed by the API for this request.",
    };
  }

  if (Number(body.n) > 1) {
    return {
      code: "unsupported_n",
      message: "Claude Code CLI answers once per request; n > 1 has no equivalent. "
        + "Send the request as many times as you need completions.",
    };
  }

  return null;
}

/** Fields present on this request that the CLI will not act on. */
export function ignoredRequestFields(body = {}) {
  return IGNORED_FIELDS.filter((field) => body[field] !== undefined && body[field] !== null);
}

/** Whether the caller's tools should be advertised at all. */
export function toolsAreWanted(body = {}) {
  return toolChoiceKind(body.tool_choice) !== "none";
}
