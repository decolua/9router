// Unit tests for open-sse/translator/validate.js
// Covers: per-format shape checks, internal-key detection, and the stripInternalKeys helper.
import { describe, it, expect } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import {
	validateOutboundPayload,
	stripInternalKeys,
	INTERNAL_KEYS,
} from "../../open-sse/translator/validate.js";

const validBase = {
	model: "gpt-4o",
	messages: [{ role: "user", content: "hi" }],
};

describe("validateOutboundPayload: openai", () => {
	it("accepts a minimal valid openai body", () => {
		const res = validateOutboundPayload(FORMATS.OPENAI, validBase);
		expect(res.ok).toBe(true);
		expect(res.errors).toEqual([]);
	});

	it("accepts a body with tools and tool_calls", () => {
		const body = {
			model: "gpt-4o",
			messages: [
				{ role: "user", content: "weather?" },
				{
					role: "assistant",
					content: "",
					tool_calls: [
						{
							id: "c1",
							type: "function",
							function: { name: "get_weather", arguments: "{}" },
						},
					],
				},
				{ role: "tool", tool_call_id: "c1", content: "sunny" },
			],
			tools: [
				{
					type: "function",
					function: {
						name: "get_weather",
						parameters: {
							type: "object",
							properties: { city: { type: "string" } },
						},
					},
				},
			],
		};
		expect(validateOutboundPayload(FORMATS.OPENAI, body).ok).toBe(true);
	});

	it("rejects when model is missing", () => {
		const body = { messages: [{ role: "user", content: "hi" }] };
		const res = validateOutboundPayload(FORMATS.OPENAI, body);
		expect(res.ok).toBe(false);
		expect(res.errors.some((e) => e.path === "model")).toBe(true);
	});

	it("rejects when messages is empty", () => {
		const res = validateOutboundPayload(FORMATS.OPENAI, {
			...validBase,
			messages: [],
		});
		expect(res.ok).toBe(false);
		expect(res.errors[0].path).toBe("messages");
	});

	it("rejects assistant with neither content nor tool_calls", () => {
		const res = validateOutboundPayload(FORMATS.OPENAI, {
			model: "gpt-4o",
			messages: [
				{ role: "user", content: "hi" },
				{ role: "assistant", content: "" },
			],
		});
		expect(res.ok).toBe(false);
		expect(res.errors.some((e) => e.path === "messages[1].content")).toBe(true);
	});

	it("rejects tool message missing tool_call_id", () => {
		const res = validateOutboundPayload(FORMATS.OPENAI, {
			model: "gpt-4o",
			messages: [
				{ role: "user", content: "hi" },
				{ role: "tool", content: "result" },
			],
		});
		expect(res.ok).toBe(false);
		expect(res.errors.some((e) => e.path === "messages[1].tool_call_id")).toBe(
			true,
		);
	});

	it("rejects function tool missing name", () => {
		const res = validateOutboundPayload(FORMATS.OPENAI, {
			model: "gpt-4o",
			messages: [{ role: "user", content: "hi" }],
			tools: [{ type: "function", function: { parameters: {} } }],
		});
		expect(res.ok).toBe(false);
		expect(res.errors.some((e) => e.path === "tools[0].function.name")).toBe(
			true,
		);
	});

	it("accepts system role message", () => {
		const res = validateOutboundPayload(FORMATS.OPENAI, {
			model: "gpt-4o",
			messages: [{ role: "system", content: "be helpful" }],
		});
		expect(res.ok).toBe(true);
	});

	it("accepts developer role message", () => {
		const res = validateOutboundPayload(FORMATS.OPENAI, {
			model: "gpt-4o",
			messages: [
				{ role: "developer", content: "you are an assistant" },
				{ role: "user", content: "hi" },
			],
		});
		expect(res.ok).toBe(true);
	});

	it("accepts message with array content blocks using text type", () => {
		const res = validateOutboundPayload(FORMATS.OPENAI, {
			model: "gpt-4o",
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: "hello" }],
				},
			],
		});
		expect(res.ok).toBe(true);
	});

	it("accepts message with array content blocks using image_url type", () => {
		const res = validateOutboundPayload(FORMATS.OPENAI, {
			model: "gpt-4o",
			messages: [
				{
					role: "user",
					content: [
						{
							type: "image_url",
							image_url: { url: "https://example.com/img.png" },
						},
					],
				},
			],
		});
		expect(res.ok).toBe(true);
	});

	it("accepts function tool with valid parameters object", () => {
		const res = validateOutboundPayload(FORMATS.OPENAI, {
			model: "gpt-4o",
			messages: [{ role: "user", content: "hi" }],
			tools: [
				{
					type: "function",
					function: {
						name: "get_weather",
						parameters: {
							type: "object",
							properties: { city: { type: "string" } },
						},
					},
				},
			],
		});
		expect(res.ok).toBe(true);
	});

	it("accepts function tool with null parameters", () => {
		const res = validateOutboundPayload(FORMATS.OPENAI, {
			model: "gpt-4o",
			messages: [{ role: "user", content: "hi" }],
			tools: [
				{
					type: "function",
					function: { name: "get_weather", parameters: null },
				},
			],
		});
		expect(res.ok).toBe(true);
	});

	it("rejects function tool with invalid parameters type", () => {
		const res = validateOutboundPayload(FORMATS.OPENAI, {
			model: "gpt-4o",
			messages: [{ role: "user", content: "hi" }],
			tools: [
				{
					type: "function",
					function: { name: "get_weather", parameters: "not an object" },
				},
			],
		});
		expect(res.ok).toBe(false);
		expect(
			res.errors.some((e) => e.path === "tools[0].function.parameters"),
		).toBe(true);
	});

	it("accepts tool without type field (pass-through, not type:function)", () => {
		// Only type:function requires the .function sub-object.
		// Tools without a type are accepted as-is.
		const res = validateOutboundPayload(FORMATS.OPENAI, {
			model: "gpt-4o",
			messages: [{ role: "user", content: "hi" }],
			tools: [{ function: { name: "get_weather", parameters: {} } }],
		});
		expect(res.ok).toBe(true);
	});

	it("accepts function tool missing function field when not type:function", () => {
		// Only type:function requires .function — other tool types are pass-through
		const res = validateOutboundPayload(FORMATS.OPENAI, {
			model: "gpt-4o",
			messages: [{ role: "user", content: "hi" }],
			tools: [{ name: "some_tool" }],
		});
		expect(res.ok).toBe(true);
	});
});

describe("validateOutboundPayload: claude", () => {
	it("accepts a minimal valid claude body", () => {
		const res = validateOutboundPayload(FORMATS.CLAUDE, {
			model: "claude-opus-4-6",
			max_tokens: 1024,
			messages: [{ role: "user", content: "hi" }],
		});
		expect(res.ok).toBe(true);
	});

	it("rejects when max_tokens is missing", () => {
		const res = validateOutboundPayload(FORMATS.CLAUDE, {
			model: "claude-opus-4-6",
			messages: [{ role: "user", content: "hi" }],
		});
		expect(res.ok).toBe(false);
		expect(res.errors.some((e) => e.path === "max_tokens")).toBe(true);
	});

	it("rejects unsupported message role", () => {
		const res = validateOutboundPayload(FORMATS.CLAUDE, {
			model: "claude-opus-4-6",
			max_tokens: 1024,
			messages: [{ role: "tool", content: "x" }],
		});
		expect(res.ok).toBe(false);
		expect(res.errors.some((e) => e.path === "messages[0].role")).toBe(true);
	});

	it("rejects unsupported content block type", () => {
		const res = validateOutboundPayload(FORMATS.CLAUDE, {
			model: "claude-opus-4-6",
			max_tokens: 1024,
			messages: [{ role: "user", content: [{ type: "video", video_url: {} }] }],
		});
		expect(res.ok).toBe(false);
		expect(
			res.errors.some((e) => e.path.startsWith("messages[0].content[0].type")),
		).toBe(true);
	});

	it("accepts extended tool/result block types", () => {
		const res = validateOutboundPayload(FORMATS.CLAUDE, {
			model: "claude-opus-4-6",
			max_tokens: 1024,
			messages: [
				{
					role: "user",
					content: [
						{ type: "server_tool_use", id: "s1", name: "read", input: {} },
						{ type: "web_search_tool_result", tool_use_id: "w1", content: [] },
						{ type: "mcp_tool_use", id: "m1", name: "mcp", input: {} },
						{ type: "mcp_tool_result", tool_use_id: "m1", content: "ok" },
						{ type: "search_result", content: "result" },
						{
							type: "code_execution_tool_result",
							tool_use_id: "c1",
							output: "42",
						},
					],
				},
			],
		});
		expect(res.ok).toBe(true);
		expect(res.errors).toEqual([]);
	});

	it("rejects tool without name", () => {
		const res = validateOutboundPayload(FORMATS.CLAUDE, {
			model: "claude-opus-4-6",
			max_tokens: 1024,
			messages: [{ role: "user", content: "hi" }],
			tools: [{ input_schema: {} }],
		});
		expect(res.ok).toBe(false);
		expect(res.errors.some((e) => e.path === "tools[0].name")).toBe(true);
	});

	it("accepts system as a string", () => {
		const res = validateOutboundPayload(FORMATS.CLAUDE, {
			model: "claude-opus-4-6",
			max_tokens: 1024,
			system: "You are helpful.",
			messages: [{ role: "user", content: "hi" }],
		});
		expect(res.ok).toBe(true);
	});

	it("rejects system as a non-string non-array", () => {
		const res = validateOutboundPayload(FORMATS.CLAUDE, {
			model: "claude-opus-4-6",
			max_tokens: 1024,
			system: 42,
			messages: [{ role: "user", content: "hi" }],
		});
		expect(res.ok).toBe(false);
		expect(res.errors.some((e) => e.path === "system")).toBe(true);
	});

	it("accepts system as an array of text blocks", () => {
		const res = validateOutboundPayload(FORMATS.CLAUDE, {
			model: "claude-opus-4-6",
			max_tokens: 1024,
			system: [{ type: "text", text: "you are helpful" }],
			messages: [{ role: "user", content: "hi" }],
		});
		expect(res.ok).toBe(true);
	});

	it("accepts assistant role in claude messages", () => {
		const res = validateOutboundPayload(FORMATS.CLAUDE, {
			model: "claude-opus-4-6",
			max_tokens: 1024,
			messages: [
				{ role: "user", content: "hi" },
				{ role: "assistant", content: "hello" },
			],
		});
		expect(res.ok).toBe(true);
	});

	it("rejects empty messages array for claude", () => {
		const res = validateOutboundPayload(FORMATS.CLAUDE, {
			model: "claude-opus-4-6",
			max_tokens: 1024,
			messages: [],
		});
		expect(res.ok).toBe(false);
		expect(res.errors[0].path).toBe("messages");
	});

	it("rejects claude tool with non-object input_schema", () => {
		const res = validateOutboundPayload(FORMATS.CLAUDE, {
			model: "claude-opus-4-6",
			max_tokens: 1024,
			messages: [{ role: "user", content: "hi" }],
			tools: [{ name: "get_weather", input_schema: "not-an-object" }],
		});
		expect(res.ok).toBe(false);
		expect(res.errors.some((e) => e.path === "tools[0].input_schema")).toBe(
			true,
		);
	});
});

describe("validateOutboundPayload: gemini / vertex", () => {
	it("accepts a minimal valid gemini body", () => {
		const res = validateOutboundPayload(FORMATS.GEMINI, {
			model: "gemini-3-pro",
			contents: [{ role: "user", parts: [{ text: "hi" }] }],
		});
		expect(res.ok).toBe(true);
	});

	it("rejects invalid gemini role", () => {
		const res = validateOutboundPayload(FORMATS.VERTEX, {
			model: "gemini-3-pro",
			contents: [{ role: "assistant", parts: [{ text: "hi" }] }],
		});
		expect(res.ok).toBe(false);
		expect(res.errors.some((e) => e.path === "contents[0].role")).toBe(true);
	});

	it("rejects empty contents", () => {
		const res = validateOutboundPayload(FORMATS.GEMINI, {
			model: "gemini-3-pro",
			contents: [],
		});
		expect(res.ok).toBe(false);
		expect(res.errors[0].path).toBe("contents");
	});

	it("rejects content with no parts", () => {
		const res = validateOutboundPayload(FORMATS.ANTIGRAVITY, {
			model: "gemini-3-pro",
			contents: [{ role: "user" }],
		});
		expect(res.ok).toBe(false);
		expect(res.errors.some((e) => e.path === "contents[0].parts")).toBe(true);
	});

	it("accepts Antigravity Cloud Code envelope (body.request.contents)", () => {
		const res = validateOutboundPayload(FORMATS.ANTIGRAVITY, {
			model: "gemini-3-pro",
			request: {
				contents: [{ role: "user", parts: [{ text: "hi" }] }],
				generationConfig: { temperature: 0.7 },
			},
		});
		expect(res.ok).toBe(true);
		expect(res.errors).toEqual([]);
	});

	it("accepts Gemini-CLI Cloud Code envelope (body.request.contents)", () => {
		const res = validateOutboundPayload(FORMATS.GEMINI_CLI, {
			model: "gemini-3-pro",
			request: {
				contents: [{ role: "model", parts: [{ text: "hello" }] }],
			},
			safetySettings: [],
		});
		expect(res.ok).toBe(true);
		expect(res.errors).toEqual([]);
	});

	it("rejects Cloud Code envelope with missing request.contents", () => {
		const res = validateOutboundPayload(FORMATS.ANTIGRAVITY, {
			model: "gemini-3-pro",
			request: { generationConfig: {} },
		});
		expect(res.ok).toBe(false);
		expect(res.errors.some((e) => e.path === "request.contents")).toBe(true);
	});

	it("reports request.contents[<idx>] paths for Cloud Code envelope errors", () => {
		const res = validateOutboundPayload(FORMATS.GEMINI_CLI, {
			model: "gemini-3-pro",
			request: {
				contents: [{ role: "assistant", parts: [{ text: "hi" }] }],
			},
		});
		expect(res.ok).toBe(false);
		expect(res.errors.some((e) => e.path === "request.contents[0].role")).toBe(
			true,
		);
	});
});

describe("validateOutboundPayload: openai-responses", () => {
	it("accepts a body with input[]", () => {
		const res = validateOutboundPayload(FORMATS.OPENAI_RESPONSES, {
			model: "gpt-5",
			input: [{ role: "user", content: "hi" }],
		});
		expect(res.ok).toBe(true);
	});

	it("rejects when neither input[] nor messages[] present", () => {
		const res = validateOutboundPayload(FORMATS.OPENAI_RESPONSES, {
			model: "gpt-5",
		});
		expect(res.ok).toBe(false);
		expect(res.errors.some((e) => e.path === "input")).toBe(true);
	});
});

describe("validateOutboundPayload: internal-key leak detection", () => {
	it("rejects body with _toolNameMap", () => {
		const res = validateOutboundPayload(FORMATS.OPENAI, {
			...validBase,
			_toolNameMap: new Map([["a", "b"]]),
		});
		expect(res.ok).toBe(false);
		expect(res.errors.some((e) => e.path === "_toolNameMap")).toBe(true);
	});

	it("rejects body with _clientSessionId", () => {
		const res = validateOutboundPayload(FORMATS.CLAUDE, {
			model: "claude-opus-4-6",
			max_tokens: 1024,
			messages: [{ role: "user", content: "hi" }],
			_clientSessionId: "abc-123",
		});
		expect(res.ok).toBe(false);
		expect(res.errors.some((e) => e.path === "_clientSessionId")).toBe(true);
	});
});

describe("stripInternalKeys", () => {
	it("removes both known internal keys", () => {
		const body = {
			model: "gpt-4o",
			messages: [{ role: "user", content: "hi" }],
			_toolNameMap: "x",
			_clientSessionId: "y",
		};
		stripInternalKeys(body);
		expect(body._toolNameMap).toBeUndefined();
		expect(body._clientSessionId).toBeUndefined();
	});

	it("removes other underscore-prefixed keys (silent strip)", () => {
		const body = { model: "gpt-4o", _unknown_internal: "leak" };
		stripInternalKeys(body);
		expect(body._unknown_internal).toBeUndefined();
	});

	it("returns the body unchanged for non-object input", () => {
		expect(stripInternalKeys(null)).toBeNull();
		expect(stripInternalKeys(undefined)).toBeUndefined();
	});

	it("does not strip keys that don't start with underscore", () => {
		const body = { model: "gpt-4o", tool_choice: "auto" };
		stripInternalKeys(body);
		expect(body.tool_choice).toBe("auto");
	});

	it("INTERNAL_KEYS is frozen and lists the known leaks", () => {
		expect(Object.isFrozen(INTERNAL_KEYS)).toBe(true);
		expect(INTERNAL_KEYS).toContain("_toolNameMap");
		expect(INTERNAL_KEYS).toContain("_clientSessionId");
	});
});

describe("validateOutboundPayload: edge cases", () => {
	it("rejects null body", () => {
		const res = validateOutboundPayload(FORMATS.OPENAI, null);
		expect(res.ok).toBe(false);
	});

	it("rejects non-object body", () => {
		const res = validateOutboundPayload(FORMATS.OPENAI, "not-an-object");
		expect(res.ok).toBe(false);
	});

	it("rejects unknown target format with missing model", () => {
		const res = validateOutboundPayload("some-future-format", { messages: [] });
		expect(res.ok).toBe(false);
		expect(res.errors.some((e) => e.path === "model")).toBe(true);
	});
});

// ---- Format routing: each entry in the switch table must reach the right validator

describe("validateOutboundPayload: format table routing", () => {
	it("KIRO routes to OpenAI validator (empty messages)", () => {
		const res = validateOutboundPayload(FORMATS.KIRO, {
			model: "kiro-model",
			messages: [],
		});
		expect(res.ok).toBe(false);
		expect(res.errors[0].path).toBe("messages");
	});

	it("CODEX routes to OpenAI validator (missing model)", () => {
		const res = validateOutboundPayload(FORMATS.CODEX, {
			messages: [{ role: "user", content: "hi" }],
		});
		expect(res.ok).toBe(false);
		expect(res.errors.some((e) => e.path === "model")).toBe(true);
	});

	it("OLLAMA routes to OpenAI validator (missing model)", () => {
		const res = validateOutboundPayload(FORMATS.OLLAMA, {
			messages: [{ role: "user", content: "hi" }],
		});
		expect(res.ok).toBe(false);
		expect(res.errors.some((e) => e.path === "model")).toBe(true);
	});

	it("CURSOR routes to OpenAI validator (missing model)", () => {
		const res = validateOutboundPayload(FORMATS.CURSOR, {
			messages: [{ role: "user", content: "hi" }],
		});
		expect(res.ok).toBe(false);
		expect(res.errors.some((e) => e.path === "model")).toBe(true);
	});

	it("COMMANDCODE routes to OpenAI validator (missing model)", () => {
		const res = validateOutboundPayload(FORMATS.COMMANDCODE, {
			messages: [{ role: "user", content: "hi" }],
		});
		expect(res.ok).toBe(false);
		expect(res.errors.some((e) => e.path === "model")).toBe(true);
	});

	it("VERTEX routes to Gemini validator (invalid role)", () => {
		const res = validateOutboundPayload(FORMATS.VERTEX, {
			model: "gemini-3-pro",
			contents: [{ role: "assistant", parts: [{ text: "hi" }] }],
		});
		expect(res.ok).toBe(false);
		expect(res.errors.some((e) => e.path === "contents[0].role")).toBe(true);
	});

	it("OPENAI_RESPONSE (singular) routes to OpenAIResponses validator (missing model)", () => {
		const res = validateOutboundPayload(FORMATS.OPENAI_RESPONSE, {
			input: [{ role: "user", content: "hi" }],
		});
		expect(res.ok).toBe(false);
		expect(res.errors.some((e) => e.path === "model")).toBe(true);
	});

	it("OPENAI_RESPONSES (plural) accepts messages[] as secondary path", () => {
		const res = validateOutboundPayload(FORMATS.OPENAI_RESPONSES, {
			model: "gpt-5",
			messages: [{ role: "user", content: "hi" }],
		});
		expect(res.ok).toBe(true);
	});

	it("OPENAI_RESPONSES rejects when both input[] and messages[] are empty", () => {
		const res = validateOutboundPayload(FORMATS.OPENAI_RESPONSES, {
			model: "gpt-5",
			input: [],
			messages: [],
		});
		expect(res.ok).toBe(false);
		expect(res.errors[0].path).toBe("input");
	});

	it("internal key leak detection fires regardless of target format", () => {
		const formats = [
			FORMATS.OPENAI,
			FORMATS.CLAUDE,
			FORMATS.GEMINI,
			FORMATS.VERTEX,
			FORMATS.KIRO,
			FORMATS.CODEX,
			FORMATS.OLLAMA,
			FORMATS.ANTIGRAVITY,
			FORMATS.OPENAI_RESPONSES,
		];
		for (const fmt of formats) {
			const res = validateOutboundPayload(fmt, {
				model: "test-model",
				messages: [{ role: "user", content: "hi" }],
				_clientSessionId: "leak",
			});
			expect(res.ok).toBe(false);
			expect(res.errors.some((e) => e.path === "_clientSessionId")).toBe(
				true,
				`format ${fmt} should reject _clientSessionId`,
			);
		}
	});
});
