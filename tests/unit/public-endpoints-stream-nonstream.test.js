import { beforeEach, describe, expect, it, vi } from "vitest";

import { writeStreamError } from "../../open-sse/utils/error.js";

const mocks = vi.hoisted(() => ({
	settings: { requireApiKey: false },
	auth: {
		extractApiKey: vi.fn(() => null),
		isValidApiKey: vi.fn(async () => true),
		getProviderCredentials: vi.fn(async () => ({
			connectionId: "c1",
			connectionName: "acct",
		})),
		markAccountUnavailable: vi.fn(async () => ({ shouldFallback: false })),
		clearAccountError: vi.fn(async () => {}),
	},
	model: {
		getModelInfo: vi.fn(async () => ({ provider: "openai", model: "gpt-4o" })),
		getComboModels: vi.fn(async () => null),
	},
	keyPolicy: {
		loadKeyPolicy: vi.fn(async () => ({ isActive: true })),
		checkModelAllowed: vi.fn(() => ({ allowed: true })),
		checkMonthlyLimits: vi.fn(async () => ({ allowed: true })),
	},
	handleChatCore: vi.fn(),
}));

vi.mock("open-sse/index.js", () => ({}));
vi.mock("open-sse/translator/index.js", () => ({
	initTranslators: vi.fn(async () => {}),
}));
vi.mock("@/lib/localDb", () => ({
	getSettings: vi.fn(async () => mocks.settings),
}));
vi.mock("@/sse/services/auth.js", () => mocks.auth);
vi.mock("@/sse/services/model.js", () => mocks.model);
vi.mock("@/sse/services/tokenRefresh.js", () => ({
	checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
	updateProviderCredentials: vi.fn(async () => {}),
}));
vi.mock("@/sse/services/keyPolicy.js", () => mocks.keyPolicy);
vi.mock("open-sse/services/modelFallback.js", () => ({
	runWithModelFallback: vi.fn(async (modelStr, _fallbacks, fn) => fn(modelStr)),
	isDeterministicPayloadError: vi.fn(() => false),
}));
vi.mock("open-sse/services/combo.js", () => ({
	handleComboChat: vi.fn(),
	handleFusionChat: vi.fn(),
}));
vi.mock("open-sse/utils/bypassHandler.js", () => ({
	handleBypassRequest: vi.fn(() => null),
}));
vi.mock("open-sse/utils/claudeHeaderCache.js", () => ({
	cacheClaudeHeaders: vi.fn(),
}));
vi.mock("open-sse/services/projectId.js", () => ({
	getProjectIdForConnection: vi.fn(async () => null),
}));
vi.mock("open-sse/handlers/chatCore.js", () => ({
	handleChatCore: mocks.handleChatCore,
}));

const routes = [
	{
		name: "chat completions",
		pathname: "/v1/chat/completions",
		expectedSourceFormatOverride: null,
		load: () => import("../../src/app/api/v1/chat/completions/route.js"),
	},
	{
		name: "messages",
		pathname: "/v1/messages",
		expectedSourceFormatOverride: "claude",
		load: () => import("../../src/app/api/v1/messages/route.js"),
	},
	{
		name: "responses",
		pathname: "/v1/responses",
		expectedSourceFormatOverride: "openai-responses",
		load: () => import("../../src/app/api/v1/responses/route.js"),
	},
];

function makeReq(pathname, body, headers = {}) {
	return new Request(`http://localhost${pathname}`, {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}

function resetDefaults() {
	mocks.settings.requireApiKey = false;
	mocks.auth.extractApiKey.mockReturnValue(null);
	mocks.auth.isValidApiKey.mockResolvedValue(true);
	mocks.auth.getProviderCredentials.mockResolvedValue({
		connectionId: "c1",
		connectionName: "acct",
	});
	mocks.auth.markAccountUnavailable.mockResolvedValue({
		shouldFallback: false,
	});
	mocks.auth.clearAccountError.mockResolvedValue(undefined);
	mocks.model.getModelInfo.mockResolvedValue({
		provider: "openai",
		model: "gpt-4o",
	});
	mocks.model.getComboModels.mockResolvedValue(null);
	mocks.keyPolicy.loadKeyPolicy.mockResolvedValue({ isActive: true });
	mocks.keyPolicy.checkModelAllowed.mockReturnValue({ allowed: true });
	mocks.keyPolicy.checkMonthlyLimits.mockResolvedValue({ allowed: true });
	mocks.handleChatCore.mockResolvedValue({
		success: true,
		response: new Response(JSON.stringify({ ok: true }), {
			status: 200,
			headers: { "content-type": "application/json" },
		}),
	});
}

function makeSseResponse() {
	const sse = new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode("data: {}\n\n"));
			controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
			controller.close();
		},
	});

	return new Response(sse, {
		status: 200,
		headers: { "content-type": "text/event-stream" },
	});
}

async function readAll(stream) {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let text = "";

	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		text += decoder.decode(value, { stream: true });
	}

	text += decoder.decode();
	return text;
}

async function post(route, body) {
	const { POST } = await route.load();
	return POST(makeReq(route.pathname, body));
}

describe("public endpoint non-stream and stream contracts", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetDefaults();
	});

	for (const route of routes) {
		it(`passes through non-stream success for ${route.name} and pins sourceFormatOverride`, async () => {
			const upstream = new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
			mocks.handleChatCore.mockResolvedValue({
				success: true,
				response: upstream,
			});

			const response = await post(route, {
				model: "openai/gpt-4o",
				messages: [{ role: "user", content: "hi" }],
			});
			const body = await response.json();

			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toContain(
				"application/json",
			);
			expect(body).toEqual({ ok: true });
			expect(mocks.handleChatCore).toHaveBeenCalledTimes(1);
			expect(mocks.handleChatCore.mock.calls[0][0].sourceFormatOverride).toBe(
				route.expectedSourceFormatOverride,
			);
		});

		it(`passes through stream success for ${route.name}`, async () => {
			mocks.handleChatCore.mockResolvedValue({
				success: true,
				response: makeSseResponse(),
			});

			const response = await post(route, {
				model: "openai/gpt-4o",
				messages: [{ role: "user", content: "hi" }],
				stream: true,
			});
			const text = await readAll(response.body);

			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toContain(
				"text/event-stream",
			);
			expect(text).toContain("data: [DONE]");
		});

		it(`pins unavailableResponse divergence for ${route.name}`, async () => {
			mocks.auth.getProviderCredentials.mockResolvedValue({
				allRateLimited: true,
				lastError: "rate limit",
				lastErrorCode: 429,
				retryAfter: new Date(Date.now() + 30_000).toISOString(),
				retryAfterHuman: "reset after 30s",
			});

			const response = await post(route, {
				model: "openai/gpt-4o",
				messages: [{ role: "user", content: "hi" }],
			});
			const body = await response.json();

			expect(response.status).toBe(429);
			expect(response.headers.get("content-type")).toContain(
				"application/json",
			);
			expect(response.headers.get("Retry-After")).toMatch(/^\d+$/);
			expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
			expect(body.error.message).toContain("rate limit");
			expect(body.error.message).toContain("reset after 30s");
			expect(body.error).not.toHaveProperty("type");
			expect(body.error).not.toHaveProperty("code");
		});
	}

	it("writes stream errors as OpenAI-compatible SSE data frames", async () => {
		const chunks = [];
		const writer = {
			write: vi.fn(async (chunk) => {
				chunks.push(chunk);
			}),
		};

		await writeStreamError(writer, 429, "slow down");

		const frame = new TextDecoder().decode(chunks[0]);
		expect(frame).toMatch(/^data: .+\n\n$/);

		const payload = JSON.parse(frame.slice("data: ".length).trim());
		expect(payload).toEqual({
			error: {
				message: "slow down",
				type: "rate_limit_error",
				code: "rate_limit_exceeded",
			},
		});
	});

	it("keeps OPTIONS/CORS preflight envelopes identical across public endpoints", async () => {
		const results = [];

		for (const route of routes) {
			const { OPTIONS } = await route.load();
			const response = await OPTIONS();
			results.push({
				status: response.status,
				body: await response.text(),
				allowOrigin: response.headers.get("Access-Control-Allow-Origin"),
				allowMethods: response.headers.get("Access-Control-Allow-Methods"),
				allowHeaders: response.headers.get("Access-Control-Allow-Headers"),
			});
		}

		expect(results).toEqual(Array(routes.length).fill(results[0]));
		for (const result of results) {
			expect(result.status).toBe(200);
			expect(result.body).toBe("");
			expect(result.allowOrigin).toBe("*");
			expect(result.allowMethods).toContain("POST");
			expect(result.allowHeaders).toBe("*");
		}
	});
});
