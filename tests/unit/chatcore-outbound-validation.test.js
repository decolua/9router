// Integration tests for the outbound validation gate in chatCore.js.
//
// Wires the real handleChatCore with a mocked executor and a mocked
// translateRequest so we can feed a deliberately corrupted translation
// through and assert:
//  - the gate returns HTTP 400 (createErrorResult(400, ...))
//  - executor.execute is NEVER called on validation failure
//  - the executor is called normally when validation passes (sanity check)
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const executorExecute = vi.fn();
const translateRequest = vi.fn();

vi.mock("../../open-sse/executors/index.js", () => ({
	getExecutor: () => ({
		noAuth: false,
		execute: executorExecute,
		refreshCredentials: vi.fn(),
	}),
}));

vi.mock(
	import("../../open-sse/translator/index.js"),
	async (importOriginal) => {
		const actual = await importOriginal();
		return {
			...actual,
			translateRequest: (...args) => translateRequest(...args),
		};
	},
);

// Stub out modules that would touch disk / network in a unit test.
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
	createRequestLogger: async () => ({
		logClientRawRequest: () => {},
		logRawRequest: () => {},
		logTargetRequest: () => {},
		logOpenAIRequest: () => {},
		logError: () => {},
	}),
}));

// Use process.env as the communication channel for VALIDATE_OUTBOUND toggle.
// This is global and shared across all module scopes (test file, mock factories, chatCore).
const VALIDATE_OUTBOUND_ORIG = process.env.VALIDATE_OUTBOUND;
function setValidateOutbound(val) {
	process.env.VALIDATE_OUTBOUND = val ? "true" : "false";
}
function resetValidateOutbound() {
	if (VALIDATE_OUTBOUND_ORIG === undefined) {
		delete process.env.VALIDATE_OUTBOUND;
	} else {
		process.env.VALIDATE_OUTBOUND = VALIDATE_OUTBOUND_ORIG;
	}
}

vi.mock("../../open-sse/config/runtimeConfig.js", () => ({
	HTTP_STATUS: {
		BAD_REQUEST: 400,
		UNAUTHORIZED: 401,
		NOT_FOUND: 404,
		BAD_GATEWAY: 502,
	},
	get VALIDATE_OUTBOUND() {
		// Read from process.env so the toggle works across all module scopes.
		return (
			process.env.VALIDATE_OUTBOUND == null ||
			/^(1|true|yes|on)$/i.test(process.env.VALIDATE_OUTBOUND)
		);
	},
	FETCH_CONNECT_TIMEOUT_MS: 60_000,
	DEFAULT_RETRY_CONFIG: {},
	STREAM_STALL_TIMEOUT_MS: 360_000,
	STREAM_FIRST_CHUNK_TIMEOUT_MS: 200_000,
	CACHE_TTL: {},
	MEMORY_CONFIG: {},
	ERROR_TYPES: {},
	DEFAULT_ERROR_MESSAGES: {},
	BACKOFF_CONFIG: {},
	COOLDOWN_MS: 0,
	SKIP_PATTERNS: [],
}));

vi.mock("../../src/lib/usageDb.js", () => ({
	trackPendingRequest: vi.fn(),
	appendRequestLog: vi.fn().mockResolvedValue(undefined),
	saveRequestDetail: vi.fn().mockResolvedValue(undefined),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

const baseBody = {
	model: "gpt-4o",
	messages: [{ role: "user", content: "hello" }],
};

beforeEach(() => {
	executorExecute.mockReset();
	translateRequest.mockReset();
});

afterEach(() => {
	resetValidateOutbound();
});

describe("chatCore: outbound validation gate fires on 400", () => {
	it("returns 400 when translation leaks _clientSessionId (chatCore does NOT strip this), without calling executor.execute", async () => {
		// chatCore's translated branch strips _toolNameMap but does NOT strip
		// _clientSessionId — that's the one we use to assert the gate fires.
		translateRequest.mockReturnValue({
			model: "gpt-4o",
			messages: [{ role: "user", content: "hello" }],
			_clientSessionId: "session-leak",
		});

		const result = await handleChatCore({
			body: { ...baseBody },
			modelInfo: { provider: "openai", model: "gpt-4o" },
			credentials: { accessToken: "sk-test" },
			connectionId: "c-1",
			log: { debug: () => {}, warn: () => {}, info: () => {} },
		});

		expect(result.success).toBe(false);
		expect(result.status).toBe(400);
		expect(String(result.error)).toMatch(/validation/i);
		expect(String(result.error)).toMatch(/_clientSessionId/);
		expect(executorExecute).not.toHaveBeenCalled();
	});

	it("passthrough: returns 400 when _toolNameMap reaches the gate (chatCore does NOT strip it in passthrough), without calling executor.execute", async () => {
		// In the passthrough branch (claude-cli client), chatCore does NOT pre-strip
		// _toolNameMap, so the validation gate MUST catch it and return 400.
		// This tests that the gate itself fires on _toolNameMap.
		const leaky = {
			model: "claude-opus-4-6",
			max_tokens: 1024,
			messages: [{ role: "user", content: "hello" }],
			_toolNameMap: new Map([["a", "b"]]),
		};

		const result = await handleChatCore({
			body: leaky,
			modelInfo: { provider: "claude", model: "claude-opus-4-6" },
			credentials: { accessToken: "sk-test" },
			connectionId: "c-passthrough-toolnamemap",
			clientRawRequest: {
				headers: { "user-agent": "claude-cli/1.0.0" },
				endpoint: "/v1/messages",
				body: leaky,
			},
			log: { debug: () => {}, warn: () => {}, info: () => {} },
		});

		expect(result.success).toBe(false);
		expect(result.status).toBe(400);
		expect(String(result.error)).toMatch(/validation/i);
		expect(String(result.error)).toMatch(/_toolNameMap/);
		expect(executorExecute).not.toHaveBeenCalled();
	});

	it("translated: chatCore strips _toolNameMap before the gate (L226-227), so executor IS called with clean body", async () => {
		// The translated branch strips _toolNameMap at L226-227 BEFORE the validation
		// gate runs. This test verifies that strip happens and the gate passes.
		// We mock executor success to confirm the clean path works end-to-end.
		translateRequest.mockReturnValue({
			model: "gpt-4o",
			messages: [{ role: "user", content: "hello" }],
			_toolNameMap: new Map([["a", "b"]]),
		});
		executorExecute.mockResolvedValue({
			response: new Response(
				JSON.stringify({
					choices: [{ message: { role: "assistant", content: "hi" } }],
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			),
			url: "https://api.openai.com/v1/chat/completions",
			headers: { "content-type": "application/json" },
			transformedBody: {},
		});

		const result = await handleChatCore({
			body: { ...baseBody },
			modelInfo: { provider: "openai", model: "gpt-4o" },
			credentials: { accessToken: "sk-test" },
			connectionId: "c-translated-strip",
			log: { debug: () => {}, warn: () => {}, info: () => {} },
		});

		expect(executorExecute).toHaveBeenCalledTimes(1);
		// _toolNameMap must have been stripped before reaching the executor.
		expect(executorExecute.mock.calls[0][0].body._toolNameMap).toBeUndefined();
		expect(result.success).toBe(true);
	});

	it("returns 400 when translation produces an openai body with empty messages, without calling executor.execute", async () => {
		translateRequest.mockReturnValue({
			model: "gpt-4o",
			messages: [],
		});

		const result = await handleChatCore({
			body: { ...baseBody },
			modelInfo: { provider: "openai", model: "gpt-4o" },
			credentials: { accessToken: "sk-test" },
			connectionId: "c-1",
			log: { debug: () => {}, warn: () => {}, info: () => {} },
		});

		expect(result.success).toBe(false);
		expect(result.status).toBe(400);
		expect(executorExecute).not.toHaveBeenCalled();
	});

	it("returns 400 when claude translation is missing max_tokens, without calling executor.execute", async () => {
		translateRequest.mockReturnValue({
			model: "claude-opus-4-6",
			messages: [{ role: "user", content: "hi" }],
			// max_tokens intentionally missing — chatCore does not auto-add it
		});

		const result = await handleChatCore({
			body: { ...baseBody },
			modelInfo: { provider: "claude", model: "claude-opus-4-6" },
			credentials: { accessToken: "sk-test" },
			connectionId: "c-1",
			log: { debug: () => {}, warn: () => {}, info: () => {} },
		});

		expect(result.success).toBe(false);
		expect(result.status).toBe(400);
		expect(String(result.error)).toMatch(/max_tokens/);
		expect(executorExecute).not.toHaveBeenCalled();
	});

	it("returns 400 when gemini translation has empty contents, without calling executor.execute", async () => {
		translateRequest.mockReturnValue({
			model: "gemini-3-pro",
			contents: [],
		});

		const result = await handleChatCore({
			body: { ...baseBody },
			modelInfo: { provider: "gemini", model: "gemini-3-pro" },
			credentials: { accessToken: "sk-test" },
			connectionId: "c-1",
			log: { debug: () => {}, warn: () => {}, info: () => {} },
		});

		expect(result.success).toBe(false);
		expect(result.status).toBe(400);
		expect(executorExecute).not.toHaveBeenCalled();
	});
});

describe("chatCore: passthrough stripInternalKeys (defense in depth)", () => {
	it("passthrough: strips _unknownInternal via stripInternalKeys (defensive strip), executor IS called", async () => {
		// Force passthrough branch: claude-cli client + claude provider.
		// _unknownInternal is NOT in INTERNAL_KEYS so the validation gate passes.
		// The stripInternalKeys pass must remove it before the executor is called.
		// This test is deterministic: executor MUST be called, and _unknownInternal
		// must NOT appear in the body that reaches the executor.
		const leaky = {
			model: "claude-opus-4-6",
			max_tokens: 1024,
			messages: [{ role: "user", content: "hello" }],
			_unknownInternal: "this-would-leak-if-not-stripped",
		};
		executorExecute.mockResolvedValue({
			response: new Response(
				JSON.stringify({
					type: "message",
					content: { type: "text", text: "ok" },
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			),
			url: "https://api.anthropic.com/v1/messages",
			headers: { "content-type": "application/json" },
			transformedBody: leaky,
		});

		await handleChatCore({
			body: leaky,
			modelInfo: { provider: "claude", model: "claude-opus-4-6" },
			credentials: { accessToken: "sk-test" },
			connectionId: "c-unknown-strip",
			clientRawRequest: {
				headers: { "user-agent": "claude-cli/1.0.0" },
				endpoint: "/v1/messages",
				body: leaky,
			},
			log: { debug: () => {}, warn: () => {}, info: () => {} },
		});

		// Deterministic outcome: executor was called and _unknownInternal was stripped.
		expect(executorExecute).toHaveBeenCalledTimes(1);
		const execArg = executorExecute.mock.calls[0][0];
		expect(execArg.body._unknownInternal).toBeUndefined();
	});

	it("strips _clientSessionId from passthrough body via the validation gate (no translator involved)", async () => {
		// Force passthrough branch: claude-cli client + claude provider. In the
		// passthrough branch, chatCore does NOT strip _clientSessionId, so the
		// validation gate must catch it and return 400.
		const leaky = {
			model: "claude-opus-4-6",
			messages: [{ role: "user", content: "hello" }],
			_clientSessionId: "leak",
		};

		const result = await handleChatCore({
			body: leaky,
			modelInfo: { provider: "claude", model: "claude-opus-4-6" },
			credentials: { accessToken: "sk-test" },
			connectionId: "c-1",
			clientRawRequest: {
				headers: { "user-agent": "claude-cli/1.0.0" },
				endpoint: "/v1/messages",
				body: leaky,
			},
			log: { debug: () => {}, warn: () => {}, info: () => {} },
		});

		expect(result.success).toBe(false);
		expect(result.status).toBe(400);
		expect(String(result.error)).toMatch(/validation/i);
		expect(executorExecute).not.toHaveBeenCalled();
	});
});

describe("chatCore: executor is called when validation passes", () => {
	it("passthrough clean body: executor.execute IS called (validation passes)", async () => {
		// Passthrough branch with a fully clean body. The gate must pass,
		// stripInternalKeys runs, and executor must be called.
		const clean = {
			model: "claude-opus-4-6",
			max_tokens: 1024,
			messages: [{ role: "user", content: "hello" }],
		};
		executorExecute.mockResolvedValue({
			response: new Response(
				JSON.stringify({
					type: "message",
					content: { type: "text", text: "hi" },
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			),
			url: "https://api.anthropic.com/v1/messages",
			headers: { "content-type": "application/json" },
			transformedBody: clean,
		});

		const result = await handleChatCore({
			body: clean,
			modelInfo: { provider: "claude", model: "claude-opus-4-6" },
			credentials: { accessToken: "sk-test" },
			connectionId: "c-clean-passthrough",
			clientRawRequest: {
				headers: { "user-agent": "claude-cli/1.0.0" },
				endpoint: "/v1/messages",
				body: clean,
			},
			log: { debug: () => {}, warn: () => {}, info: () => {} },
		});

		expect(executorExecute).toHaveBeenCalledTimes(1);
		expect(result.success).toBe(true);
	});

	it("translated clean body: executor.execute IS called (validation passes)", async () => {
		// Translated branch: mock returns a valid openai-shaped body. The gate
		// must pass and executor must be called.
		translateRequest.mockReturnValue({
			model: "gpt-4o",
			messages: [{ role: "user", content: "hello" }],
		});
		executorExecute.mockResolvedValue({
			response: new Response(
				JSON.stringify({
					choices: [{ message: { role: "assistant", content: "hi" } }],
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			),
			url: "https://api.openai.com/v1/chat/completions",
			headers: { "content-type": "application/json" },
			transformedBody: {},
		});

		const result = await handleChatCore({
			body: { ...baseBody },
			modelInfo: { provider: "openai", model: "gpt-4o" },
			credentials: { accessToken: "sk-test" },
			connectionId: "c-clean-translated",
			log: { debug: () => {}, warn: () => {}, info: () => {} },
		});

		expect(translateRequest).toHaveBeenCalled();
		expect(executorExecute).toHaveBeenCalledTimes(1);
		expect(result.success).toBe(true);
	});
});

describe("chatCore: VALIDATE_OUTBOUND=false bypasses gate but stripInternalKeys still runs", () => {
	it("VALIDATE_OUTBOUND=false: executor is called even with a body that would fail validation", async () => {
		// With VALIDATE_OUTBOUND=false, the gate is bypassed. A body that would
		// normally fail validation (e.g. missing max_tokens for claude) must still
		// reach the executor — the bypass works as designed.
		setValidateOutbound(false);

		// This body would fail validation in claude (missing max_tokens), but
		// with VALIDATE_OUTBOUND=false the gate is bypassed entirely.
		translateRequest.mockReturnValue({
			model: "claude-opus-4-6",
			messages: [{ role: "user", content: "hi" }],
			// max_tokens intentionally missing
		});
		executorExecute.mockResolvedValue({
			response: new Response(
				JSON.stringify({
					type: "message",
					content: { type: "text", text: "ok" },
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			),
			url: "https://api.anthropic.com/v1/messages",
			headers: { "content-type": "application/json" },
			transformedBody: {},
		});

		const result = await handleChatCore({
			body: { ...baseBody },
			modelInfo: { provider: "claude", model: "claude-opus-4-6" },
			credentials: { accessToken: "sk-test" },
			connectionId: "c-bypass",
			log: { debug: () => {}, warn: () => {}, info: () => {} },
		});

		// Gate bypassed: executor IS called even though body would fail.
		expect(executorExecute).toHaveBeenCalledTimes(1);
		expect(result.success).toBe(true);
	});

	it("VALIDATE_OUTBOUND=false: stripInternalKeys still removes internal keys", async () => {
		// Even with VALIDATE_OUTBOUND=false, stripInternalKeys runs unconditionally.
		// Unknown underscore keys must still be stripped so they don't leak upstream.
		setValidateOutbound(false);

		translateRequest.mockReturnValue({
			model: "claude-opus-4-6",
			max_tokens: 1024,
			messages: [{ role: "user", content: "hi" }],
			_unknownInternal: "this-would-leak-if-not-stripped",
		});
		executorExecute.mockResolvedValue({
			response: new Response(
				JSON.stringify({
					type: "message",
					content: { type: "text", text: "ok" },
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			),
			url: "https://api.anthropic.com/v1/messages",
			headers: { "content-type": "application/json" },
			transformedBody: {},
		});

		await handleChatCore({
			body: { ...baseBody },
			modelInfo: { provider: "claude", model: "claude-opus-4-6" },
			credentials: { accessToken: "sk-test" },
			connectionId: "c-strip-bypass",
			log: { debug: () => {}, warn: () => {}, info: () => {} },
		});

		// Verify that _unknownInternal was stripped before reaching executor.
		expect(executorExecute).toHaveBeenCalledTimes(1);
		const execArg = executorExecute.mock.calls[0][0];
		expect(execArg.body._unknownInternal).toBeUndefined();
	});

	it("VALIDATE_OUTBOUND=false: known internal keys _toolNameMap and _clientSessionId are also stripped", async () => {
		// The strip pass runs after the gate. With VALIDATE_OUTBOUND=false the
		// gate is off but stripInternalKeys still removes all underscore keys,
		// including the known internal ones. This is the belt-and-suspenders
		// guarantee.
		setValidateOutbound(false);

		translateRequest.mockReturnValue({
			model: "claude-opus-4-6",
			max_tokens: 1024,
			messages: [{ role: "user", content: "hi" }],
			_toolNameMap: "should-not-leak",
			_clientSessionId: "should-not-leak-either",
		});
		executorExecute.mockResolvedValue({
			response: new Response(
				JSON.stringify({
					type: "message",
					content: { type: "text", text: "ok" },
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			),
			url: "https://api.anthropic.com/v1/messages",
			headers: { "content-type": "application/json" },
			transformedBody: {},
		});

		await handleChatCore({
			body: { ...baseBody },
			modelInfo: { provider: "claude", model: "claude-opus-4-6" },
			credentials: { accessToken: "sk-test" },
			connectionId: "c-known-leak-bypass",
			log: { debug: () => {}, warn: () => {}, info: () => {} },
		});

		const execArg = executorExecute.mock.calls[0][0];
		expect(execArg.body._toolNameMap).toBeUndefined();
		expect(execArg.body._clientSessionId).toBeUndefined();
	});
});
