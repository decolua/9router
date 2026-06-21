import { describe, expect, it } from "vitest";
import "../registerAll.js";
import { translateRequest } from "../../../open-sse/translator/index.js";
import { FORMATS } from "../../../open-sse/translator/formats.js";
import {
	claudeRequestFixture,
	openAIChatForResponsesFixture,
	openAIChatRequestFixture,
	responsesRequestFixture,
} from "./fixtures.js";

export const REQUEST_ASSERTED_IDS = [
	"req.oai_to_claude.model",
	"req.oai_to_claude.max_tokens",
	"req.oai_to_claude.stream",
	"req.oai_to_claude.temperature",
	"req.oai_to_claude.messages_text",
	"req.oai_to_claude.assistant_tool_calls_to_tool_use",
	"req.oai_to_claude.tool_role_to_tool_result",
	"req.oai_to_claude.image_data_uri",
	"req.oai_to_claude.image_http_url",
	"req.oai_to_claude.pdf_file_to_document",
	"req.oai_to_claude.tools",
	"req.oai_to_claude.tool_choice_auto_required_forced_none",
	"req.oai_to_claude.response_format_json",
	"req.oai_to_claude.reasoning_effort",
	"req.oai_to_claude.system",
	"req.oai_to_claude.top_p",
	"req.oai_to_claude.metadata_user",
	"req.oai_to_claude.stop",
	"req.oai_to_claude.parallel_tool_calls",
	"req.claude_to_oai.model",
	"req.claude_to_oai.max_tokens",
	"req.claude_to_oai.temperature",
	"req.claude_to_oai.system_and_billing_strip",
	"req.claude_to_oai.tool_use_to_tool_calls",
	"req.claude_to_oai.tool_result_to_tool_message",
	"req.claude_to_oai.fix_missing_tool_responses",
	"req.claude_to_oai.image_base64",
	"req.claude_to_oai.tools",
	"req.claude_to_oai.tool_choice_auto_any_tool",
	"req.claude_to_oai.tool_result_is_error",
	"req.claude_to_oai.tool_result_image_blocks",
	"req.claude_to_oai.image_url_source",
	"req.claude_to_oai.document_block",
	"req.claude_to_oai.top_p",
	"req.claude_to_oai.stop_sequences",
	"req.claude_to_oai.metadata_user",
	"req.responses_to_chat.input_items_to_messages",
	"req.responses_to_chat.instructions_to_system",
	"req.responses_to_chat.function_call_to_tool_calls",
	"req.responses_to_chat.function_call_output_to_tool",
	"req.responses_to_chat.reasoning_to_reasoning_content",
	"req.responses_to_chat.input_image_to_image_url",
	"req.responses_to_chat.max_output_tokens_to_max_tokens",
	"req.responses_to_chat.reasoning_effort",
	"req.chat_to_responses.messages_to_input",
	"req.chat_to_responses.system_to_instructions",
	"req.chat_to_responses.tool_calls_to_function_call",
	"req.chat_to_responses.tool_message_to_function_call_output",
	"req.chat_to_responses.reasoning_effort",
	"req.chat_to_responses.image_url_to_input_image",
];

function allBlocks(messages) {
	return messages.flatMap((message) =>
		Array.isArray(message.content) ? message.content : [],
	);
}

function translateOpenAIToClaude(body = openAIChatRequestFixture()) {
	return translateRequest(
		FORMATS.OPENAI,
		FORMATS.CLAUDE,
		"claude-opus-4-6",
		body,
		true,
		{ apiKey: "sk-test" },
		"anthropic",
	);
}

describe("PA-01 request parity: OpenAI Chat -> Claude", () => {
	it("preserves core request envelope and content blocks", () => {
		const out = translateOpenAIToClaude();
		const blocks = allBlocks(out.messages);

		expect(out.model).toBe("claude-opus-4-6");
		expect(out.max_tokens).toBeGreaterThanOrEqual(4096);
		expect(out.stream).toBe(true);
		expect(out.temperature).toBe(0.2);
		expect(out.top_p).toBe(0.8);
		expect(out.stop_sequences).toEqual(["END"]);
		expect(out.metadata).toEqual({ user_id: "user-123" });
		expect(out.tool_choice).toEqual({
			type: "auto",
			disable_parallel_tool_use: true,
		});
		expect(blocks).toContainEqual(
			expect.objectContaining({ type: "text", text: "Describe the assets." }),
		);
		expect(blocks).toContainEqual(
			expect.objectContaining({
				type: "image",
				source: { type: "base64", media_type: "image/png", data: "SU1H" },
			}),
		);
		expect(blocks).toContainEqual(
			expect.objectContaining({
				type: "image",
				source: { type: "url", url: "https://example.test/image.png" },
			}),
		);
		expect(blocks).toContainEqual(
			expect.objectContaining({
				type: "document",
				source: { type: "base64", media_type: "application/pdf", data: "UERG" },
			}),
		);
		expect(blocks).toContainEqual(
			expect.objectContaining({
				type: "tool_use",
				id: "call_weather",
				name: "get_weather",
				input: { city: "BA" },
			}),
		);
		expect(blocks).toContainEqual(
			expect.objectContaining({
				type: "tool_result",
				tool_use_id: "call_weather",
				content: "sunny",
			}),
		);
		expect(out.tools).toContainEqual(
			expect.objectContaining({
				name: "get_weather",
				input_schema: expect.objectContaining({ type: "object" }),
			}),
		);
	});

	it("preserves system, JSON response format guidance, and reasoning effort", () => {
		const out = translateOpenAIToClaude();
		const systemText = out.system.map((block) => block.text || "").join("\n");
		const reasoningOut = translateOpenAIToClaude({
			messages: [{ role: "user", content: "Think." }],
			reasoning_effort: "high",
		});

		expect(systemText).toContain("System instructions.");
		expect(systemText).toContain("valid JSON");
		expect(systemText).toContain('"answer"');
		expect(reasoningOut.thinking || reasoningOut.output_config).toBeTruthy();
	});

	it("maps OpenAI tool_choice forms to Claude tool_choice", () => {
		expect(
			translateOpenAIToClaude({
				...openAIChatRequestFixture(),
				parallel_tool_calls: true,
				tool_choice: "auto",
			}).tool_choice,
		).toEqual({ type: "auto" });
		expect(
			translateOpenAIToClaude({
				...openAIChatRequestFixture(),
				parallel_tool_calls: true,
				tool_choice: "required",
			}).tool_choice,
		).toEqual({ type: "any" });
		expect(
			translateOpenAIToClaude({
				...openAIChatRequestFixture(),
				parallel_tool_calls: true,
				tool_choice: { type: "function", function: { name: "get_weather" } },
			}).tool_choice,
		).toEqual({ type: "tool", name: "get_weather" });
		expect(
			translateOpenAIToClaude({
				...openAIChatRequestFixture(),
				parallel_tool_calls: true,
				tool_choice: { type: "none" },
			}).tool_choice,
		).toEqual({ type: "none" });
	});
});

describe("PA-01 request parity: Claude -> OpenAI Chat", () => {
	it("preserves Claude envelope, system, media, tools, and tool messages", () => {
		const out = translateRequest(
			FORMATS.CLAUDE,
			FORMATS.OPENAI,
			"gpt-test",
			claudeRequestFixture(),
			true,
		);

		expect(out.model).toBe("gpt-test");
		expect(out.max_tokens).toBeGreaterThanOrEqual(2048);
		expect(out.temperature).toBe(0.4);
		expect(out.top_p).toBe(0.7);
		expect(out.stop).toEqual(["HALT"]);
		expect(out.user).toBe("claude-user-123");
		expect(out).not.toHaveProperty("top_k");
		expect(out.messages[0]).toEqual({
			role: "system",
			content: "Claude system.",
		});
		expect(JSON.stringify(out.messages)).toContain(
			"data:image/png;base64,SU1H",
		);
		expect(JSON.stringify(out.messages)).toContain(
			"https://example.test/claude-image.png",
		);
		expect(JSON.stringify(out.messages)).toContain(
			"data:application/pdf;base64,RE9D",
		);
		expect(out.messages).toContainEqual(
			expect.objectContaining({
				role: "assistant",
				tool_calls: expect.arrayContaining([
					expect.objectContaining({
						id: "toolu_1",
						function: expect.objectContaining({
							name: "get_weather",
							arguments: '{"city":"BA"}',
						}),
					}),
				]),
			}),
		);
		expect(out.messages).toContainEqual(
			expect.objectContaining({
				role: "tool",
				tool_call_id: "toolu_1",
				content: "[tool_error] sunny",
			}),
		);
		expect(JSON.stringify(out.messages)).toContain(
			"data:image/png;base64,VE9PTF9JTUc=",
		);
		expect(out.messages).toContainEqual(
			expect.objectContaining({
				role: "tool",
				tool_call_id: "toolu_2",
				content: "[No response received]",
			}),
		);
		expect(out.tools).toContainEqual(
			expect.objectContaining({
				type: "function",
				function: expect.objectContaining({ name: "get_weather" }),
			}),
		);
		expect(out.tool_choice).toEqual({
			type: "function",
			function: { name: "get_weather" },
		});
	});

	it("maps Claude tool_choice auto and any", () => {
		expect(
			translateRequest(
				FORMATS.CLAUDE,
				FORMATS.OPENAI,
				"gpt-test",
				{ ...claudeRequestFixture(), tool_choice: { type: "auto" } },
				true,
			).tool_choice,
		).toBe("auto");
		expect(
			translateRequest(
				FORMATS.CLAUDE,
				FORMATS.OPENAI,
				"gpt-test",
				{ ...claudeRequestFixture(), tool_choice: { type: "any" } },
				true,
			).tool_choice,
		).toBe("required");
	});
});

describe("PA-01 request parity: OpenAI Responses <-> Chat pivot", () => {
	it("maps Responses API requests to Chat Completions requests", () => {
		const out = translateRequest(
			FORMATS.OPENAI_RESPONSES,
			FORMATS.OPENAI,
			"gpt-5",
			responsesRequestFixture(),
			true,
		);

		expect(out.messages[0]).toEqual({
			role: "system",
			content: "Follow response API instructions.",
		});
		expect(out.messages).toContainEqual(
			expect.objectContaining({
				role: "user",
				content: expect.arrayContaining([
					{ type: "text", text: "Hello" },
					{
						type: "image_url",
						image_url: { url: "data:image/png;base64,SU1H", detail: "high" },
					},
				]),
			}),
		);
		expect(out.messages).toContainEqual(
			expect.objectContaining({
				role: "assistant",
				reasoning_content: "reasoned",
				tool_calls: expect.arrayContaining([
					expect.objectContaining({
						id: "call_response",
						function: expect.objectContaining({
							name: "lookup",
							arguments: '{"q":"x"}',
						}),
					}),
				]),
			}),
		);
		expect(out.messages).toContainEqual({
			role: "tool",
			tool_call_id: "call_response",
			content: "result",
		});
		expect(out.max_tokens).toBe(321);
		expect(out.reasoning_effort).toBe("medium");
	});

	it("maps Chat Completions requests to Responses API requests", () => {
		const out = translateRequest(
			FORMATS.OPENAI,
			FORMATS.OPENAI_RESPONSES,
			"gpt-5",
			openAIChatForResponsesFixture(),
			true,
		);
		const reasoningOut = translateRequest(
			FORMATS.OPENAI,
			FORMATS.OPENAI_RESPONSES,
			"gpt-5",
			{ messages: [{ role: "user", content: "Hi" }], reasoning_effort: "low" },
			true,
		);

		expect(out.instructions).toBe("Chat system.");
		expect(out.input).toContainEqual(
			expect.objectContaining({
				type: "message",
				role: "user",
				content: expect.arrayContaining([
					{ type: "input_text", text: "Hi" },
					{
						type: "input_image",
						image_url: "https://example.test/cat.png",
						detail: "low",
					},
				]),
			}),
		);
		expect(out.input).toContainEqual({
			type: "function_call",
			call_id: "call_chat",
			name: "lookup",
			arguments: '{"q":"cat"}',
		});
		expect(out.input).toContainEqual({
			type: "function_call_output",
			call_id: "call_chat",
			output: "cat result",
		});
		expect(
			reasoningOut.reasoning?.effort || reasoningOut.reasoning_effort,
		).toBe("low");
	});
});
