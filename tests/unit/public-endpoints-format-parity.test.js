import { describe, expect, it } from "vitest";

import { detectFormatByEndpoint } from "../../open-sse/translator/formats.js";

describe("public endpoint source format parity", () => {
	it("pins /v1/responses to OpenAI Responses format", () => {
		expect(
			detectFormatByEndpoint("/v1/responses", { model: "openai/gpt-4o" }),
		).toBe("openai-responses");
	});

	it("pins /v1/messages to Claude format", () => {
		expect(
			detectFormatByEndpoint("/v1/messages", { model: "openai/gpt-4o" }),
		).toBe("claude");
	});

	it("keeps /v1/chat/completions on body-based detection for normal chat bodies", () => {
		expect(
			detectFormatByEndpoint("/v1/chat/completions", {
				model: "openai/gpt-4o",
				messages: [],
			}),
		).toBeNull();
	});

	it("treats /v1/chat/completions with input[] as OpenAI format", () => {
		expect(
			detectFormatByEndpoint("/v1/chat/completions", {
				model: "openai/gpt-4o",
				input: [],
			}),
		).toBe("openai");
	});

	it("falls back to body-based detection for unknown paths", () => {
		expect(
			detectFormatByEndpoint("/v1/unknown", {
				model: "openai/gpt-4o",
				messages: [],
			}),
		).toBeNull();
	});
});
