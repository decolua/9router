import { describe, expect, it } from "vitest";
import "../registerAll.js";
import { FORMATS } from "../../../open-sse/translator/formats.js";
import {
	claudeServerToolEvents,
	claudeStreamEvents,
	openAIContentFilterStreamEvents,
	openAIStreamEvents,
	responsesCustomToolStreamEvents,
	responsesStreamEvents,
	runStream,
} from "./fixtures.js";

export const RESPONSE_ASSERTED_IDS = [
	"resp.claude_to_oai.message_start_role",
	"resp.claude_to_oai.text_delta",
	"resp.claude_to_oai.thinking_delta",
	"resp.claude_to_oai.tool_use_to_tool_calls",
	"resp.claude_to_oai.input_json_delta",
	"resp.claude_to_oai.usage",
	"resp.claude_to_oai.finish_reason",
	"resp.claude_to_oai.redacted_thinking",
	"resp.oai_to_claude.message_start",
	"resp.oai_to_claude.content_to_text",
	"resp.oai_to_claude.reasoning_to_thinking",
	"resp.oai_to_claude.tool_calls_buffered",
	"resp.oai_to_claude.usage_cache_split",
	"resp.oai_to_claude.finish_reason",
	"resp.oai_to_claude.content_filter",
	"resp.oai_to_claude.thinking_signature",
	"resp.responses_to_chat.text_reasoning_tool_usage",
	"resp.responses_to_chat.custom_tool_call",
	"resp.chat_to_responses.text_reasoning_tool_completed",
];

describe("PA-01 response parity: Claude -> OpenAI", () => {
	it("maps Claude stream role, text, thinking, tool calls, usage, and finish reason", () => {
		const out = runStream(FORMATS.CLAUDE, FORMATS.OPENAI, claudeStreamEvents);

		expect(out).toContainEqual(
			expect.objectContaining({
				choices: [
					expect.objectContaining({
						delta: { role: "assistant" },
						finish_reason: null,
					}),
				],
			}),
		);
		expect(out).toContainEqual(
			expect.objectContaining({
				choices: [
					expect.objectContaining({
						delta: expect.objectContaining({ content: "Hello" }),
					}),
				],
			}),
		);
		expect(JSON.stringify(out)).toContain("<think>");
		expect(JSON.stringify(out)).toContain("think");
		expect(JSON.stringify(out)).toContain("[redacted]");
		expect(out).toContainEqual(
			expect.objectContaining({
				choices: [
					expect.objectContaining({
						delta: expect.objectContaining({
							tool_calls: [
								expect.objectContaining({
									id: "toolu_1",
									function: expect.objectContaining({ name: "get_weather" }),
								}),
							],
						}),
					}),
				],
			}),
		);
		expect(out).toContainEqual(
			expect.objectContaining({
				choices: [
					expect.objectContaining({
						delta: expect.objectContaining({
							tool_calls: [
								expect.objectContaining({
									function: { arguments: '{"city":"BA"}' },
								}),
							],
						}),
					}),
				],
			}),
		);
		expect(out).toContainEqual(
			expect.objectContaining({
				usage: expect.objectContaining({
					prompt_tokens: 15,
					completion_tokens: 5,
					total_tokens: 20,
				}),
			}),
		);
		expect(out.at(-1).choices[0].finish_reason).toBe("tool_calls");
	});

	it("keeps documented server_tool_use loss explicit by skipping provider-internal tool chunks", () => {
		const out = runStream(
			FORMATS.CLAUDE,
			FORMATS.OPENAI,
			claudeServerToolEvents,
		);

		expect(JSON.stringify(out)).not.toContain("web_search");
		expect(JSON.stringify(out)).not.toContain("server_tool_use");
		expect(out.at(-1).choices[0].finish_reason).toBe("stop");
	});
});

describe("PA-01 response parity: OpenAI -> Claude", () => {
	it("maps OpenAI stream message, content, reasoning, buffered tools, cache usage, and finish reason", () => {
		const out = runStream(FORMATS.OPENAI, FORMATS.CLAUDE, openAIStreamEvents);

		expect(out[0]).toEqual(
			expect.objectContaining({
				type: "message_start",
				message: expect.objectContaining({
					role: "assistant",
					model: "gpt-test",
				}),
			}),
		);
		expect(out).toContainEqual(
			expect.objectContaining({
				type: "content_block_start",
				content_block: expect.objectContaining({ type: "thinking" }),
			}),
		);
		expect(out).toContainEqual(
			expect.objectContaining({
				type: "content_block_delta",
				delta: { type: "thinking_delta", thinking: "plan" },
			}),
		);
		expect(out).toContainEqual(
			expect.objectContaining({
				type: "content_block_delta",
				delta: expect.objectContaining({ type: "signature_delta" }),
			}),
		);
		expect(out).toContainEqual(
			expect.objectContaining({
				type: "content_block_delta",
				delta: { type: "text_delta", text: "Answer" },
			}),
		);
		expect(out).toContainEqual(
			expect.objectContaining({
				type: "content_block_start",
				content_block: expect.objectContaining({
					type: "tool_use",
					id: "call_read",
					name: "Read",
					input: {},
				}),
			}),
		);
		expect(out).toContainEqual(
			expect.objectContaining({
				type: "content_block_delta",
				delta: {
					type: "input_json_delta",
					partial_json: '{"file_path":"a.txt","limit":2000,"offset":0}',
				},
			}),
		);
		expect(out).toContainEqual(
			expect.objectContaining({
				type: "message_delta",
				delta: { stop_reason: "tool_use" },
				usage: {
					input_tokens: 15,
					output_tokens: 7,
					cache_read_input_tokens: 3,
					cache_creation_input_tokens: 2,
				},
			}),
		);
		expect(out.at(-1)).toEqual({ type: "message_stop" });
	});

	it("maps OpenAI content_filter finish to Claude refusal", () => {
		const out = runStream(
			FORMATS.OPENAI,
			FORMATS.CLAUDE,
			openAIContentFilterStreamEvents,
		);

		expect(out).toContainEqual(
			expect.objectContaining({
				type: "message_delta",
				delta: { stop_reason: "refusal" },
			}),
		);
	});
});

describe("PA-01 response parity: OpenAI Responses <-> Chat pivot", () => {
	it("maps Responses API text, reasoning, tool calls, and usage to Chat chunks", () => {
		const out = runStream(
			FORMATS.OPENAI_RESPONSES,
			FORMATS.OPENAI,
			responsesStreamEvents,
		);

		expect(out).toContainEqual(
			expect.objectContaining({
				choices: [
					expect.objectContaining({
						delta: expect.objectContaining({ content: "Hello" }),
					}),
				],
			}),
		);
		expect(JSON.stringify(out)).toContain("thinking");
		expect(out).toContainEqual(
			expect.objectContaining({
				choices: [
					expect.objectContaining({
						delta: expect.objectContaining({
							tool_calls: [
								expect.objectContaining({
									id: "call_resp",
									function: expect.objectContaining({ name: "lookup" }),
								}),
							],
						}),
					}),
				],
			}),
		);
		expect(out).toContainEqual(
			expect.objectContaining({
				choices: [
					expect.objectContaining({
						delta: expect.objectContaining({
							tool_calls: [
								expect.objectContaining({
									function: { arguments: '{"q":"x"}' },
								}),
							],
						}),
					}),
				],
			}),
		);
		expect(out.at(-1)).toEqual(
			expect.objectContaining({
				usage: expect.objectContaining({
					prompt_tokens: 11,
					completion_tokens: 4,
					total_tokens: 15,
				}),
			}),
		);
	});

	it("maps Responses API custom_tool_call variant to Chat tool chunks", () => {
		const out = runStream(
			FORMATS.OPENAI_RESPONSES,
			FORMATS.OPENAI,
			responsesCustomToolStreamEvents,
		);

		expect(out).toContainEqual(
			expect.objectContaining({
				choices: [
					expect.objectContaining({
						delta: expect.objectContaining({
							tool_calls: [
								expect.objectContaining({
									id: "call_custom",
									function: expect.objectContaining({ name: "custom_runner" }),
								}),
							],
						}),
					}),
				],
			}),
		);
		expect(out).toContainEqual(
			expect.objectContaining({
				choices: [
					expect.objectContaining({
						delta: expect.objectContaining({
							tool_calls: [
								expect.objectContaining({ function: { arguments: "payload" } }),
							],
						}),
					}),
				],
			}),
		);
	});

	it("maps Chat stream text, reasoning, tools, and completion into Responses API events", () => {
		const out = runStream(
			FORMATS.OPENAI,
			FORMATS.OPENAI_RESPONSES,
			openAIStreamEvents,
		);

		expect(out).toContainEqual(
			expect.objectContaining({
				event: "response.created",
				data: expect.objectContaining({ type: "response.created" }),
			}),
		);
		expect(out).toContainEqual(
			expect.objectContaining({
				event: "response.reasoning_summary_text.delta",
				data: expect.objectContaining({ delta: "plan" }),
			}),
		);
		expect(out).toContainEqual(
			expect.objectContaining({
				event: "response.output_text.delta",
				data: expect.objectContaining({ delta: "Answer" }),
			}),
		);
		expect(out).toContainEqual(
			expect.objectContaining({
				event: "response.output_item.added",
				data: expect.objectContaining({
					item: expect.objectContaining({
						type: "function_call",
						call_id: "call_read",
						name: "Read",
					}),
				}),
			}),
		);
		expect(out).toContainEqual(
			expect.objectContaining({
				event: "response.function_call_arguments.delta",
				data: expect.objectContaining({
					delta: '{"file_path":"a.txt","limit":"5000","offset":"-2"}',
				}),
			}),
		);
		expect(out).toContainEqual(
			expect.objectContaining({
				event: "response.completed",
				data: expect.objectContaining({
					response: expect.objectContaining({ status: "completed" }),
				}),
			}),
		);
	});
});
