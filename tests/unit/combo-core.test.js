import { describe, expect, it, vi } from "vitest";

import {
	buildJudgePrompt,
	detectRequiredCapabilities,
	extractPanelText,
	flattenToolHistory,
	getComboModelsFromData,
	handleComboChat,
	reorderByCapabilities,
} from "../../open-sse/services/combo.js";

const log = { info: () => {}, warn: () => {}, debug: () => {} };

// Stub Response factory matching what handleSingleModel returns.
function okResponse(content) {
	const json = { choices: [{ message: { role: "assistant", content } }] };
	const make = () => ({
		ok: true,
		status: 200,
		clone: make,
		json: async () => json,
	});
	return make();
}

function errResponse(status = 500, errMsg = "boom") {
	const json = { error: { message: errMsg } };
	const make = () => ({
		ok: false,
		status,
		clone: make,
		json: async () => json,
	});
	return make();
}

// ---------------------------------------------------------------------------
// 1. Combo data lookup
// ---------------------------------------------------------------------------
describe("getComboModelsFromData", () => {
	it("returns null for model strings with a slash (provider/model)", () => {
		expect(getComboModelsFromData("provider/model-a", [])).toBeNull();
	});

	it("returns null when no combo name matches", () => {
		expect(getComboModelsFromData("unknown", [])).toBeNull();
	});

	it("returns models array when name matches an array-formatted combo", () => {
		const combos = [
			{ name: "my-combo", models: ["a/x", "b/y"] },
			{ name: "other", models: ["c/z"] },
		];
		expect(getComboModelsFromData("my-combo", combos)).toEqual(["a/x", "b/y"]);
	});

	it("returns models array when name matches an object-formatted combo", () => {
		const combos = {
			combos: [{ name: "obj-combo", models: ["p/m1", "p/m2"] }],
		};
		expect(getComboModelsFromData("obj-combo", combos)).toEqual([
			"p/m1",
			"p/m2",
		]);
	});

	it("returns null when name matches but models array is empty", () => {
		const combos = [{ name: "empty", models: [] }];
		expect(getComboModelsFromData("empty", combos)).toBeNull();
	});

	it("returns null when combosData is empty object", () => {
		expect(getComboModelsFromData("x", {})).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// 2. Fallback strategy (handleComboChat)
// ---------------------------------------------------------------------------
describe("handleComboChat — fallback strategy", () => {
	it("returns the first model's response on success", async () => {
		const handleSingleModel = vi.fn(async (_body, model) => {
			return okResponse(`ok-${model}`);
		});
		const res = await handleComboChat({
			body: { messages: [{ role: "user", content: "hi" }] },
			models: ["p/a", "p/b"],
			handleSingleModel,
			log,
			comboStrategy: "fallback",
		});
		expect(res.ok).toBe(true);
		const json = await res.clone().json();
		expect(json.choices[0].message.content).toBe("ok-p/a");
		expect(handleSingleModel).toHaveBeenCalledTimes(1);
	});

	it("falls through to the next model when the first fails", async () => {
		const calls = [];
		const handleSingleModel = vi.fn(async (_body, model) => {
			calls.push(model);
			if (calls.length === 1) return errResponse(503, "overloaded");
			return okResponse(`ok-${model}`);
		});
		const res = await handleComboChat({
			body: { messages: [{ role: "user", content: "hi" }] },
			models: ["p/first", "p/second"],
			handleSingleModel,
			log,
			comboStrategy: "fallback",
		});
		expect(res.ok).toBe(true);
		const json = await res.clone().json();
		expect(json.choices[0].message.content).toBe("ok-p/second");
		expect(handleSingleModel).toHaveBeenCalledTimes(2);
	});

	it("tries all models and returns the last error status when all fail", async () => {
		const handleSingleModel = vi.fn(async () =>
			errResponse(502, "bad gateway"),
		);
		const res = await handleComboChat({
			body: { messages: [{ role: "user", content: "hi" }] },
			models: ["p/a", "p/b", "p/c"],
			handleSingleModel,
			log,
			comboStrategy: "fallback",
		});
		// Last model's status code is propagated.
		expect(res.status).toBe(502);
		const json = await res.clone().json();
		expect(json.error.message).toContain("bad gateway");
		expect(handleSingleModel).toHaveBeenCalledTimes(3);
	});

	it("returns 503 with message when all models report credential errors", async () => {
		const handleSingleModel = vi.fn(async () =>
			errResponse(401, "no credentials"),
		);
		const res = await handleComboChat({
			body: { messages: [{ role: "user", content: "hi" }] },
			models: ["p/a", "p/b"],
			handleSingleModel,
			log,
			comboStrategy: "fallback",
		});
		// "no credentials" sets status to 503 (allDisabled) but does NOT prevent fallback.
		expect(handleSingleModel).toHaveBeenCalledTimes(2);
		expect(res.status).toBe(503);
		const json = await res.clone().json();
		expect(json.error.message).toContain("no credentials");
	});

	it("catches thrown errors and continues fallback", async () => {
		const calls = [];
		const handleSingleModel = vi.fn(async (_body, model) => {
			calls.push(model);
			if (calls.length === 1) throw new Error("network failure");
			return okResponse(`ok-${model}`);
		});
		const res = await handleComboChat({
			body: { messages: [{ role: "user", content: "hi" }] },
			models: ["p/a", "p/b"],
			handleSingleModel,
			log,
			comboStrategy: "fallback",
		});
		expect(res.ok).toBe(true);
		expect(calls).toEqual(["p/a", "p/b"]);
	});
});

// ---------------------------------------------------------------------------
// 3. handleComboChat — capacity auto-switch
// ---------------------------------------------------------------------------
describe("handleComboChat — capacity auto-switch", () => {
	it("reorders models when auto-switch detects vision requirement", async () => {
		const models = ["deepseek/deepseek-chat", "cc/claude-sonnet-5"];
		const seen = [];
		const handleSingleModel = vi.fn(async (_body, model) => {
			seen.push(model);
			return okResponse(`ok-${model}`);
		});
		await handleComboChat({
			body: {
				messages: [
					{
						role: "user",
						content: [{ type: "image_url", image_url: { url: "x" } }],
					},
				],
			},
			models,
			handleSingleModel,
			log,
			comboStrategy: "fallback",
			autoSwitch: true,
		});
		expect(seen[0]).toBe("cc/claude-sonnet-5");
		expect(handleSingleModel).toHaveBeenCalledTimes(1);
	});

	it("falls through to non-vision model when capable one fails", async () => {
		const models = ["deepseek/deepseek-chat", "cc/claude-sonnet-5"];
		const seen = [];
		const handleSingleModel = vi.fn(async (_body, model) => {
			seen.push(model);
			if (model === "cc/claude-sonnet-5") return errResponse(503, "capacity");
			return okResponse(`ok-${model}`);
		});
		const res = await handleComboChat({
			body: {
				messages: [
					{
						role: "user",
						content: [{ type: "image_url", image_url: { url: "x" } }],
					},
				],
			},
			models,
			handleSingleModel,
			log,
			comboStrategy: "fallback",
			autoSwitch: true,
		});
		expect(seen[0]).toBe("cc/claude-sonnet-5");
		expect(seen[1]).toBe("deepseek/deepseek-chat");
		expect(res.ok).toBe(true);
	});

	it("does not reorder when autoSwitch is false", async () => {
		const models = ["deepseek/deepseek-chat", "cc/claude-sonnet-5"];
		const seen = [];
		const handleSingleModel = vi.fn(async (_body, model) => {
			seen.push(model);
			return okResponse(`ok-${model}`);
		});
		await handleComboChat({
			body: {
				messages: [
					{
						role: "user",
						content: [{ type: "image_url", image_url: { url: "x" } }],
					},
				],
			},
			models,
			handleSingleModel,
			log,
			comboStrategy: "fallback",
			autoSwitch: false,
		});
		expect(seen[0]).toBe("deepseek/deepseek-chat");
	});
});

// ---------------------------------------------------------------------------
// 4. flattenToolHistory
// ---------------------------------------------------------------------------
describe("flattenToolHistory", () => {
	it("preserves non-tool messages unchanged", () => {
		const msgs = [
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi there" },
		];
		expect(flattenToolHistory(msgs)).toEqual(msgs);
	});

	it("flattens OpenAI tool_calls to prose", () => {
		const msgs = [
			{ role: "user", content: "do it" },
			{
				role: "assistant",
				content: "",
				tool_calls: [
					{ id: "c1", type: "function", function: { name: "search" } },
				],
			},
			{ role: "tool", tool_call_id: "c1", content: "results" },
		];
		const flat = flattenToolHistory(msgs);
		expect(flat[1].tool_calls).toBeUndefined();
		expect(flat[1].content).toContain("[Called tools: search]");
		expect(flat[2].role).toBe("assistant");
		expect(flat[2].content).toContain("[Tool result: results]");
	});

	it("flattens Anthropic tool_use/tool_result blocks in content arrays", () => {
		const msgs = [
			{ role: "user", content: "analyze" },
			{
				role: "assistant",
				content: [
					{ type: "text", text: "thinking" },
					{ type: "tool_use", id: "t1", name: "analyze" },
				],
			},
			{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "t1", content: "done" }],
			},
		];
		const flat = flattenToolHistory(msgs);
		expect(flat[1].content).toContain("thinking");
		expect(flat[1].content).toContain("[Called tools: analyze]");
		expect(flat[2].content).toContain("[Tool result: done]");
	});

	it("rebuilds function messages as assistant tool_result", () => {
		const msgs = [
			{ role: "user", content: "calc" },
			{ role: "function", name: "calc", content: "42" },
		];
		const flat = flattenToolHistory(msgs);
		expect(flat[1].role).toBe("assistant");
		expect(flat[1].content).toContain("42");
	});

	it("removes null/undefined entries", () => {
		const msgs = [
			{ role: "user", content: "a" },
			null,
			{ role: "user", content: "b" },
		];
		expect(flattenToolHistory(msgs).length).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// 5. extractPanelText
// ---------------------------------------------------------------------------
describe("extractPanelText", () => {
	it("extracts from OpenAI chat completion", () => {
		expect(
			extractPanelText({ choices: [{ message: { content: "hello" } }] }),
		).toBe("hello");
	});

	it("extracts from OpenAI delta", () => {
		expect(
			extractPanelText({ choices: [{ delta: { content: "world" } }] }),
		).toBe("world");
	});

	it("extracts from Claude messages format", () => {
		expect(
			extractPanelText({
				content: [{ type: "text", text: "claude-answer" }],
			}),
		).toBe("claude-answer");
	});

	it("extracts from Gemini format", () => {
		expect(
			extractPanelText({
				candidates: [{ content: { parts: [{ text: "gemini" }] } }],
			}),
		).toBe("gemini");
	});

	it("extracts from OpenAI Responses API", () => {
		expect(
			extractPanelText({
				output: [{ content: [{ text: "responses" }] }],
			}),
		).toBe("responses");
	});

	it("returns empty string for unknown format", () => {
		expect(extractPanelText({})).toBe("");
	});

	it("returns empty string for null/undefined", () => {
		expect(extractPanelText(null)).toBe("");
		expect(extractPanelText(undefined)).toBe("");
	});
});

// ---------------------------------------------------------------------------
// 6. buildJudgePrompt
// ---------------------------------------------------------------------------
describe("buildJudgePrompt", () => {
	it("includes anonymized sources with panel answers", () => {
		const prompt = buildJudgePrompt([
			{ model: "claude", text: "answer A" },
			{ model: "gpt", text: "answer B" },
		]);
		expect(prompt).toContain("[Source 1]");
		expect(prompt).toContain("answer A");
		expect(prompt).toContain("[Source 2]");
		expect(prompt).toContain("answer B");
		expect(prompt).not.toContain("claude");
		expect(prompt).not.toContain("gpt");
	});

	it("includes the judge directive", () => {
		const prompt = buildJudgePrompt([{ model: "x", text: "ans" }]);
		expect(prompt).toContain("JUDGE");
		expect(prompt).toContain("model-fusion panel");
		expect(prompt).toContain("final answer");
		expect(prompt).toContain("=== PANEL RESPONSES ===");
	});
});

// ---------------------------------------------------------------------------
// 7. detectRequiredCapabilities — edge cases
// ---------------------------------------------------------------------------
describe("detectRequiredCapabilities — edge cases", () => {
	it("returns empty set for null body", () => {
		expect(detectRequiredCapabilities(null).size).toBe(0);
	});

	it("returns empty set for empty body", () => {
		expect(detectRequiredCapabilities({}).size).toBe(0);
	});

	it("detects gemini inlineData with image MIME", () => {
		const r = detectRequiredCapabilities({
			contents: [
				{
					role: "user",
					parts: [{ inlineData: { mimeType: "image/png", data: "x" } }],
				},
			],
		});
		expect(r.has("vision")).toBe(true);
	});

	it("detects gemini fileData for PDF", () => {
		const r = detectRequiredCapabilities({
			contents: [
				{
					role: "user",
					parts: [
						{ fileData: { mimeType: "application/pdf", fileUri: "gs://x" } },
					],
				},
			],
		});
		expect(r.has("pdf")).toBe(true);
	});

	it("ignores non-modality mime types", () => {
		const r = detectRequiredCapabilities({
			contents: [
				{
					role: "user",
					parts: [{ inlineData: { mimeType: "text/plain", data: "x" } }],
				},
			],
		});
		expect(r.size).toBe(0);
	});

	it("scans only trailing user turn, not history", () => {
		const r = detectRequiredCapabilities({
			messages: [
				{
					role: "user",
					content: [{ type: "image_url", image_url: { url: "old" } }],
				},
				{ role: "assistant", content: "ok" },
				{ role: "user", content: "text-only now" },
			],
		});
		expect(r.has("vision")).toBe(false);
	});

	it("scans Responses API input format", () => {
		const r = detectRequiredCapabilities({
			input: [
				{ role: "user", content: [{ type: "input_image", image_url: "x" }] },
			],
		});
		expect(r.has("vision")).toBe(true);
	});

	it("scans antigravity request.contents format", () => {
		const r = detectRequiredCapabilities({
			request: {
				contents: [
					{
						role: "user",
						parts: [{ inlineData: { mimeType: "image/jpeg", data: "x" } }],
					},
				],
			},
		});
		expect(r.has("vision")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 8. reorderByCapabilities — strategy coverage
// ---------------------------------------------------------------------------
describe("reorderByCapabilities", () => {
	it("floats vision-capable model to front", () => {
		const models = ["deepseek/deepseek-chat", "cc/claude-sonnet-5"];
		expect(reorderByCapabilities(models, new Set(["vision"]))[0]).toBe(
			"cc/claude-sonnet-5",
		);
	});

	it("keeps order when no model matches capabilities", () => {
		const models = ["deepseek/deepseek-chat", "deepseek/deepseek-reasoner"];
		expect(reorderByCapabilities(models, new Set(["vision"]))).toEqual(models);
	});

	it("preserves original order within tiers", () => {
		const models = [
			"cc/claude-sonnet-5",
			"cc/claude-opus-4-8",
			"deepseek/deepseek-chat",
		];
		const out = reorderByCapabilities(models, new Set(["vision"]));
		expect(out[0]).toBe("cc/claude-sonnet-5");
		expect(out[1]).toBe("cc/claude-opus-4-8");
	});

	it("returns unchanged for single model", () => {
		expect(reorderByCapabilities(["a/x"], new Set(["vision"]))).toEqual([
			"a/x",
		]);
	});

	it("returns unchanged for no required caps", () => {
		expect(reorderByCapabilities(["a/x", "b/y"], new Set())).toEqual([
			"a/x",
			"b/y",
		]);
	});
});
