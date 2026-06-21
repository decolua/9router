import { beforeEach, describe, expect, it, vi } from "vitest";

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
		load: () => import("../../src/app/api/v1/chat/completions/route.js"),
	},
	{
		name: "messages",
		pathname: "/v1/messages",
		load: () => import("../../src/app/api/v1/messages/route.js"),
	},
	{
		name: "responses",
		pathname: "/v1/responses",
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

async function post(route, body, headers) {
	const { POST } = await route.load();
	return POST(makeReq(route.pathname, body, headers));
}

async function readError(route, body, setup = () => {}, headers) {
	resetDefaults();
	await setup();
	const response = await post(route, body, headers);
	const payload = await response.json();
	return {
		route: route.name,
		status: response.status,
		cors: response.headers.get("Access-Control-Allow-Origin"),
		contentType: response.headers.get("Content-Type"),
		message: payload.error?.message,
		type: payload.error?.type,
		code: payload.error?.code,
	};
}

async function expectParity({ name, body, setup, headers, expected }) {
	const results = [];
	for (const route of routes) {
		results.push(await readError(route, body, setup, headers));
	}

	const parityShape = results.map(({ status, type, code }) => ({
		status,
		type,
		code,
	}));
	expect(parityShape, name).toEqual(Array(routes.length).fill(parityShape[0]));

	for (const result of results) {
		expect(result, `${name}: ${result.route}`).toMatchObject({
			status: expected.status,
			cors: "*",
			type: expected.type,
			code: expected.code,
		});
		expect(result.contentType).toContain("application/json");
		if (expected.message) expect(result.message).toContain(expected.message);
	}
}

describe("public endpoint error-envelope parity", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetDefaults();
	});

	it("emits deep-equal invalid JSON envelopes across all public endpoints", async () => {
		await expectParity({
			name: "invalid JSON",
			body: "{not json",
			expected: {
				status: 400,
				type: "invalid_request_error",
				code: "bad_request",
				message: "Invalid JSON body",
			},
		});
	});

	it("emits deep-equal missing model envelopes across all public endpoints", async () => {
		await expectParity({
			name: "missing model",
			body: {},
			expected: {
				status: 400,
				type: "invalid_request_error",
				code: "bad_request",
				message: "Missing model",
			},
		});
	});

	it("emits deep-equal missing required API key envelopes across all public endpoints", async () => {
		await expectParity({
			name: "missing required API key",
			body: { model: "openai/gpt-4o" },
			setup: () => {
				mocks.settings.requireApiKey = true;
				mocks.auth.extractApiKey.mockReturnValue(null);
			},
			expected: {
				status: 401,
				type: "authentication_error",
				code: "invalid_api_key",
				message: "Missing API key",
			},
		});
	});

	it("emits deep-equal invalid required API key envelopes across all public endpoints", async () => {
		await expectParity({
			name: "invalid required API key",
			body: { model: "openai/gpt-4o" },
			setup: () => {
				mocks.settings.requireApiKey = true;
				mocks.auth.extractApiKey.mockReturnValue("sk");
				mocks.auth.isValidApiKey.mockResolvedValue(false);
			},
			expected: {
				status: 401,
				type: "authentication_error",
				code: "invalid_api_key",
				message: "Invalid API key",
			},
		});
	});

	it("emits deep-equal unknown key-policy envelopes across all public endpoints", async () => {
		await expectParity({
			name: "unknown key",
			body: { model: "openai/gpt-4o" },
			setup: () => {
				mocks.auth.extractApiKey.mockReturnValue("sk");
				mocks.keyPolicy.loadKeyPolicy.mockResolvedValue(null);
			},
			expected: {
				status: 401,
				type: "authentication_error",
				code: "invalid_api_key",
				message: "Invalid API key",
			},
		});
	});

	it("emits deep-equal inactive key envelopes across all public endpoints", async () => {
		await expectParity({
			name: "inactive key",
			body: { model: "openai/gpt-4o" },
			setup: () => {
				mocks.auth.extractApiKey.mockReturnValue("sk");
				mocks.keyPolicy.loadKeyPolicy.mockResolvedValue({ isActive: false });
			},
			expected: {
				status: 401,
				type: "authentication_error",
				code: "invalid_api_key",
				message: "Inactive API key",
			},
		});
	});

	it("emits deep-equal monthly budget cap envelopes across all public endpoints", async () => {
		await expectParity({
			name: "monthly budget cap",
			body: { model: "openai/gpt-4o" },
			setup: () => {
				mocks.auth.extractApiKey.mockReturnValue("sk");
				mocks.keyPolicy.checkMonthlyLimits.mockResolvedValue({
					allowed: false,
					scope: "budget",
					reason: "monthly budget reached",
				});
			},
			expected: {
				status: 402,
				type: "billing_error",
				code: "payment_required",
				message: "monthly budget reached",
			},
		});
	});

	it("emits deep-equal monthly rate cap envelopes across all public endpoints", async () => {
		await expectParity({
			name: "monthly rate cap",
			body: { model: "openai/gpt-4o" },
			setup: () => {
				mocks.auth.extractApiKey.mockReturnValue("sk");
				mocks.keyPolicy.checkMonthlyLimits.mockResolvedValue({
					allowed: false,
					scope: "rate",
					reason: "monthly rate reached",
				});
			},
			expected: {
				status: 429,
				type: "rate_limit_error",
				code: "rate_limit_exceeded",
				message: "monthly rate reached",
			},
		});
	});

	it("emits deep-equal model-not-allowed envelopes across all public endpoints", async () => {
		await expectParity({
			name: "model not allowed",
			body: { model: "openai/gpt-4o" },
			setup: () => {
				mocks.auth.extractApiKey.mockReturnValue("sk");
				mocks.keyPolicy.checkModelAllowed.mockReturnValue({
					allowed: false,
					reason: "model blocked",
				});
			},
			expected: {
				status: 403,
				type: "permission_error",
				code: "insufficient_quota",
				message: "model blocked",
			},
		});
	});

	it("emits deep-equal no active credentials envelopes across all public endpoints", async () => {
		await expectParity({
			name: "no active credentials",
			body: { model: "openai/gpt-4o" },
			setup: () => {
				mocks.auth.getProviderCredentials.mockResolvedValue(null);
			},
			expected: {
				status: 404,
				type: "invalid_request_error",
				code: "model_not_found",
				message: "No active credentials for provider",
			},
		});
	});

	it("emits deep-equal invalid model format envelopes across all public endpoints", async () => {
		await expectParity({
			name: "invalid model format",
			body: { model: "bad-model" },
			setup: () => {
				mocks.model.getModelInfo.mockResolvedValue({ provider: null });
			},
			expected: {
				status: 400,
				type: "invalid_request_error",
				code: "bad_request",
				message: "Invalid model format",
			},
		});
	});
});
