// Integration tests that run real translateRequest() calls (no mock) and validate
// the output against validateOutboundPayload(). This ensures the gate accepts
// legitimate provider payloads that the real translator produces.
//
// F4 fix: the original test suite only used synthetic bodies. This fills the
// false-positive protection gap: if the real translator emits a content-block
// type, role, or tool shape not in the validator's allowlist, the gate returns
// 400 on legitimate production traffic.
import { describe, it, expect } from "vitest";
import { translateRequest } from "../../open-sse/translator/index.js";
import { validateOutboundPayload } from "../../open-sse/translator/validate.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// Helper: run validateOutboundPayload for a given format and return ok + errors.
// Strips _toolNameMap after translateRequest because chatCore does this at L226-227
// BEFORE the validation gate runs — so the gate never sees it.
function check(targetFormat, body) {
	// Simulate chatCore L226-227: strip _toolNameMap before validation
	const cleanBody = { ...body };
	delete cleanBody._toolNameMap;
	const result = validateOutboundPayload(targetFormat, cleanBody);
	return result;
}

// ---- OpenAI → Claude (tools-bearing) ----------------------------------------

describe("Real translateRequest: OpenAI → Claude with tools", () => {
	it("translates openai+gpt4 tools-bearing request → claude format and passes validation", () => {
		// Representative production payload: user message + assistant tool call + tool result
		const source = {
			model: "gpt-4o",
			messages: [
				{ role: "user", content: "What's the weather in NYC?" },
				{
					role: "assistant",
					content: null,
					tool_calls: [
						{
							id: "call_abc123",
							type: "function",
							function: { name: "get_weather", arguments: '{"city":"NYC"}' },
						},
					],
				},
				{
					role: "tool",
					tool_call_id: "call_abc123",
					content: '{"temperature":"72F","conditions":"sunny"}',
				},
			],
			tools: [
				{
					type: "function",
					function: {
						name: "get_weather",
						description: "Get current weather for a city",
						parameters: {
							type: "object",
							properties: {
								city: { type: "string", description: "City name" },
							},
							required: ["city"],
						},
					},
				},
			],
		};

		const translated = translateRequest(
			FORMATS.OPENAI,
			FORMATS.CLAUDE,
			"claude-sonnet-4-6",
			source,
			true,
			null,
			"claude",
		);

		// Assert real translator output is valid for claude target
		const result = check(FORMATS.CLAUDE, translated);
		expect(
			result.ok,
			`Expected ok=true but got errors: ${JSON.stringify(result.errors)}`,
		).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("translates openai+gpt4o with developer role → claude and passes validation", () => {
		// Developer role is supported in OpenAI but translated to claude system prompt
		const source = {
			model: "gpt-4o",
			messages: [
				{ role: "system", content: "You are helpful." },
				{ role: "developer", content: "Always be concise." },
				{ role: "user", content: "Hi" },
			],
		};

		const translated = translateRequest(
			FORMATS.OPENAI,
			FORMATS.CLAUDE,
			"claude-sonnet-4-6",
			source,
			true,
			null,
			"claude",
		);

		const result = check(FORMATS.CLAUDE, translated);
		expect(
			result.ok,
			`Expected ok=true but got errors: ${JSON.stringify(result.errors)}`,
		).toBe(true);
	});
});

// ---- Claude → OpenAI ---------------------------------------------------------

describe("Real translateRequest: Claude → OpenAI", () => {
	it("translates claude request → openai format and passes validation", () => {
		const source = {
			model: "claude-opus-4-6",
			max_tokens: 1024,
			messages: [
				{ role: "user", content: "Hello" },
				{
					role: "assistant",
					content: "Hi there! How can I help you today?",
				},
			],
		};

		const translated = translateRequest(
			FORMATS.CLAUDE,
			FORMATS.OPENAI,
			"gpt-4o",
			source,
			true,
			null,
			"openai",
		);

		const result = check(FORMATS.OPENAI, translated);
		expect(
			result.ok,
			`Expected ok=true but got errors: ${JSON.stringify(result.errors)}`,
		).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("translates claude tools request → openai function tool format and passes validation", () => {
		const source = {
			model: "claude-opus-4-6",
			max_tokens: 1024,
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "Search for news about AI" },
						{
							type: "tool_use",
							id: "toolu_01",
							name: "web_search",
							input: { query: "AI news" },
						},
					],
				},
			],
			tools: [
				{
					name: "web_search",
					description: "Search the web",
					input_schema: {
						type: "object",
						properties: { query: { type: "string" } },
						required: ["query"],
					},
				},
			],
		};

		const translated = translateRequest(
			FORMATS.CLAUDE,
			FORMATS.OPENAI,
			"gpt-4o",
			source,
			true,
			null,
			"openai",
		);

		const result = check(FORMATS.OPENAI, translated);
		expect(
			result.ok,
			`Expected ok=true but got errors: ${JSON.stringify(result.errors)}`,
		).toBe(true);
	});

	it("translates claude extended blocks (server_tool_use) → openai and passes validation", () => {
		// Claude extended block types like server_tool_use must not cause false-positive 400
		const source = {
			model: "claude-opus-4-6",
			max_tokens: 1024,
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "Run the search" },
						{
							type: "server_tool_use",
							id: "toolu_01",
							name: "web_search",
							input: { query: "AI news" },
						},
					],
				},
			],
			tools: [
				{
					name: "web_search",
					description: "Search the web",
					input_schema: { type: "object" },
				},
			],
		};

		const translated = translateRequest(
			FORMATS.CLAUDE,
			FORMATS.OPENAI,
			"gpt-4o",
			source,
			true,
			null,
			"openai",
		);

		const result = check(FORMATS.OPENAI, translated);
		expect(
			result.ok,
			`Expected ok=true but got errors: ${JSON.stringify(result.errors)}`,
		).toBe(true);
	});
});

// ---- OpenAI → Gemini ---------------------------------------------------------

describe("Real translateRequest: OpenAI → Gemini", () => {
	it("translates openai request → gemini format and passes validation", () => {
		const source = {
			model: "gpt-4o",
			messages: [
				{ role: "user", content: "Hello Gemini" },
				{ role: "assistant", content: "Hi! How can I assist?" },
			],
		};

		const translated = translateRequest(
			FORMATS.OPENAI,
			FORMATS.GEMINI,
			"gemini-2-5-flash",
			source,
			true,
			null,
			"gemini",
		);

		const result = check(FORMATS.GEMINI, translated);
		expect(
			result.ok,
			`Expected ok=true but got errors: ${JSON.stringify(result.errors)}`,
		).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("translates openai multi-turn → gemini and passes validation", () => {
		const source = {
			model: "gpt-4o",
			messages: [
				{ role: "user", content: "What's 2+2?" },
				{ role: "assistant", content: "4" },
				{ role: "user", content: "Times 3?" },
				{ role: "assistant", content: "12" },
			],
		};

		const translated = translateRequest(
			FORMATS.OPENAI,
			FORMATS.GEMINI,
			"gemini-2-5-flash",
			source,
			true,
			null,
			"gemini",
		);

		const result = check(FORMATS.GEMINI, translated);
		expect(
			result.ok,
			`Expected ok=true but got errors: ${JSON.stringify(result.errors)}`,
		).toBe(true);
	});
});

// ---- Gemini → OpenAI ---------------------------------------------------------

describe("Real translateRequest: Gemini → OpenAI", () => {
	it("translates gemini request → openai format and passes validation", () => {
		const source = {
			model: "gemini-2-5-flash",
			contents: [
				{ role: "user", parts: [{ text: "Hello" }] },
				{ role: "model", parts: [{ text: "Hi!" }] },
			],
		};

		const translated = translateRequest(
			FORMATS.GEMINI,
			FORMATS.OPENAI,
			"gpt-4o",
			source,
			true,
			null,
			"openai",
		);

		const result = check(FORMATS.OPENAI, translated);
		expect(
			result.ok,
			`Expected ok=true but got errors: ${JSON.stringify(result.errors)}`,
		).toBe(true);
	});
});

// ---- Claude → Gemini ---------------------------------------------------------

describe("Real translateRequest: Claude → Gemini", () => {
	it("translates claude → gemini (via openai pivot) and passes validation", () => {
		const source = {
			model: "claude-sonnet-4-6",
			max_tokens: 1024,
			messages: [{ role: "user", content: "Hello Gemini" }],
		};

		const translated = translateRequest(
			FORMATS.CLAUDE,
			FORMATS.GEMINI,
			"gemini-2-5-flash",
			source,
			true,
			null,
			"gemini",
		);

		const result = check(FORMATS.GEMINI, translated);
		expect(
			result.ok,
			`Expected ok=true but got errors: ${JSON.stringify(result.errors)}`,
		).toBe(true);
	});
});

// ---- OpenAI → Vertex ---------------------------------------------------------

describe("Real translateRequest: OpenAI → Vertex", () => {
	it("translates openai → vertex and passes validation", () => {
		const source = {
			model: "gpt-4o",
			messages: [{ role: "user", content: "Hello Vertex" }],
		};

		const translated = translateRequest(
			FORMATS.OPENAI,
			FORMATS.VERTEX,
			"gemini-2-5-flash",
			source,
			true,
			null,
			"vertex",
		);

		const result = check(FORMATS.VERTEX, translated);
		expect(
			result.ok,
			`Expected ok=true but got errors: ${JSON.stringify(result.errors)}`,
		).toBe(true);
	});
});

// ---- OpenAI → OLLAMA --------------------------------------------------------

describe("Real translateRequest: OpenAI → OLLAMA", () => {
	it("translates openai → ollama and passes validation", () => {
		const source = {
			model: "gpt-4o",
			messages: [{ role: "user", content: "Hello OLLAMA" }],
		};

		const translated = translateRequest(
			FORMATS.OPENAI,
			FORMATS.OLLAMA,
			"llama3",
			source,
			true,
			null,
			"ollama",
		);

		const result = check(FORMATS.OLLAMA, translated);
		expect(
			result.ok,
			`Expected ok=true but got errors: ${JSON.stringify(result.errors)}`,
		).toBe(true);
	});
});

// ---- OpenAI → CURSOR --------------------------------------------------------

describe("Real translateRequest: OpenAI → CURSOR", () => {
	it("translates openai → cursor and passes validation", () => {
		const source = {
			model: "gpt-4o",
			messages: [{ role: "user", content: "Hello CURSOR" }],
		};

		const translated = translateRequest(
			FORMATS.OPENAI,
			FORMATS.CURSOR,
			"cursor-model",
			source,
			true,
			null,
			"cursor",
		);

		const result = check(FORMATS.CURSOR, translated);
		expect(
			result.ok,
			`Expected ok=true but got errors: ${JSON.stringify(result.errors)}`,
		).toBe(true);
	});
});

// ---- Tools-bearing payload (end-to-end false-positive protection) ------------

describe("Real translateRequest: tools-bearing payloads pass validation (false-positive guard)", () => {
	it("openai tools with tool_call result → claude passes validation", () => {
		// Full tool loop: user → assistant tool_call → tool result → assistant response
		const source = {
			model: "gpt-4o",
			messages: [
				{ role: "user", content: "What's 2+2?" },
				{
					role: "assistant",
					tool_calls: [
						{
							id: "call_1",
							type: "function",
							function: { name: "calculator", arguments: '{"expr":"2+2"}' },
						},
					],
				},
				{ role: "tool", tool_call_id: "call_1", content: "4" },
				{ role: "assistant", content: "4" },
			],
			tools: [
				{
					type: "function",
					function: {
						name: "calculator",
						description: "Evaluate a math expression",
						parameters: {
							type: "object",
							properties: { expr: { type: "string" } },
							required: ["expr"],
						},
					},
				},
			],
		};

		const translated = translateRequest(
			FORMATS.OPENAI,
			FORMATS.CLAUDE,
			"claude-sonnet-4-6",
			source,
			true,
			null,
			"claude",
		);

		// chatCore strips _toolNameMap at L226-227 before the validation gate.
		// Simulate that here so we validate the body that actually reaches the gate.
		delete translated._toolNameMap;

		const result = check(FORMATS.CLAUDE, translated);
		expect(
			result.ok,
			`Expected ok=true but got errors: ${JSON.stringify(result.errors)}`,
		).toBe(true);
	});

	it("claude tools → openai passes validation", () => {
		const source = {
			model: "claude-sonnet-4-6",
			max_tokens: 1024,
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "Search for AI" },
						{
							type: "tool_use",
							id: "toolu_1",
							name: "search",
							input: { query: "AI" },
						},
					],
				},
			],
			tools: [
				{
					name: "search",
					description: "Web search",
					input_schema: {
						type: "object",
						properties: { query: { type: "string" } },
					},
				},
			],
		};

		const translated = translateRequest(
			FORMATS.CLAUDE,
			FORMATS.OPENAI,
			"gpt-4o",
			source,
			true,
			null,
			"openai",
		);

		const result = check(FORMATS.OPENAI, translated);
		expect(
			result.ok,
			`Expected ok=true but got errors: ${JSON.stringify(result.errors)}`,
		).toBe(true);
	});
});
