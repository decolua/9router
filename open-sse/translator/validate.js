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

function isNonEmptyString(v) {
	return typeof v === "string" && v.length > 0;
}

function isNullish(v) {
	return v === null || v === undefined;
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
		isNullish(body.model) ||
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
		if (!isNonEmptyString(msg.role) || !OPENAI_ROLES.has(msg.role)) {
			pushError(
				errors,
				`${p}.role`,
				`role must be one of ${[...OPENAI_ROLES].join("|")}`,
			);
		}
		if (msg.role === ROLE.ASSISTANT) {
			// Assistant must have content or tool_calls.
			const hasContent =
				msg.content !== undefined &&
				!(typeof msg.content === "string" && msg.content === "");
			const hasToolCalls =
				Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
			if (!hasContent && !hasToolCalls) {
				pushError(
					errors,
					`${p}.content`,
					"assistant message must have content or tool_calls",
				);
			}
		} else if (msg.role === ROLE.TOOL) {
			if (isNullish(msg.tool_call_id) || typeof msg.tool_call_id !== "string") {
				pushError(
					errors,
					`${p}.tool_call_id`,
					"tool message requires string tool_call_id",
				);
			}
		} else {
			if (msg.content === undefined) {
				pushError(
					errors,
					`${p}.content`,
					`${msg.role} message requires content`,
				);
			}
		}
		// Array content block type check
		if (Array.isArray(msg.content)) {
			msg.content.forEach((block, j) => {
				if (!block || typeof block !== "object") return;
				if (block.type && !OPENAI_CONTENT_TYPES.has(block.type)) {
					pushError(
						errors,
						`${p}.content[${j}].type`,
						`unsupported openai content type "${block.type}"`,
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
			if (tool.type === OPENAI_BLOCK.FUNCTION) {
				if (!tool.function || typeof tool.function !== "object") {
					pushError(
						errors,
						`${p}.function`,
						"function tool requires .function object",
					);
				} else {
					if (!isNonEmptyString(tool.function.name)) {
						pushError(
							errors,
							`${p}.function.name`,
							"function tool requires .function.name string",
						);
					}
					// parameters must be a plain object (JSON Schema) — null/undefined allowed
					if (
						tool.function.parameters != null &&
						typeof tool.function.parameters !== "object"
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
		isNullish(body.model) ||
		(typeof body.model !== "string" && typeof body.model !== "object")
	) {
		pushError(errors, "model", "model is required for claude target");
	}
	// max_tokens is mandatory for Anthropic Messages API.
	if (
		isNullish(body.max_tokens) ||
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
			if (!isNonEmptyString(msg.role) || !CLAUDE_ROLES.has(msg.role)) {
				pushError(
					errors,
					`${p}.role`,
					`role must be one of ${[...CLAUDE_ROLES].join("|")}`,
				);
			}
			// content can be a string or an array of blocks
			if (Array.isArray(msg.content)) {
				msg.content.forEach((block, j) => {
					if (!block || typeof block !== "object") return;
					if (block.type && !CLAUDE_BLOCK_TYPES.has(block.type)) {
						pushError(
							errors,
							`${p}.content[${j}].type`,
							`unsupported claude content type "${block.type}"`,
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
			if (!isNonEmptyString(tool.name)) {
				pushError(errors, `${p}.name`, "claude tool requires .name string");
			}
			if (tool.input_schema != null && typeof tool.input_schema !== "object") {
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
		isNullish(body.model) ||
		(typeof body.model !== "string" && typeof body.model !== "object")
	) {
		pushError(errors, "model", "model is required for gemini/vertex target");
	}
	// Cloud Code envelopes (Gemini-CLI / Antigravity) nest the actual Gemini
	// payload under body.request, while model stays at the top level. Resolve
	// the payload root for contents/parts validation without mutating body.
	const root =
		body.request && typeof body.request === "object" ? body.request : body;
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
		if (!isNonEmptyString(msg.role) || !GEMINI_ROLES.has(msg.role)) {
			pushError(
				errors,
				`${p}.role`,
				`role must be one of ${[...GEMINI_ROLES].join("|")}`,
			);
		}
		if (!Array.isArray(msg.parts) || msg.parts.length === 0) {
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
		isNullish(body.model) ||
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
				if (
					tool.type === OPENAI_BLOCK.FUNCTION &&
					(!tool.function || typeof tool.function !== "object")
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
	// 1. Internal key leak detection (always fails validation by name).
	for (const k of Object.keys(body)) {
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
			validateOpenAI(body, errors);
			break;
		case FORMATS.CLAUDE:
			validateClaude(body, errors);
			break;
		case FORMATS.GEMINI:
		case FORMATS.GEMINI_CLI:
		case FORMATS.ANTIGRAVITY:
		case FORMATS.VERTEX:
			validateGemini(body, errors);
			break;
		case FORMATS.OPENAI_RESPONSES:
		case FORMATS.OPENAI_RESPONSE:
			validateOpenAIResponses(body, errors);
			break;
		default:
			// Unknown target — at least require a model so we don't dispatch an
			// empty object upstream.
			if (isNullish(body.model)) {
				pushError(errors, "model", "model is required (unknown target format)");
			}
	}
	return { ok: errors.length === 0, errors };
}
