import "../registerAll.js";
import {
	initState,
	translateResponse,
} from "../../../open-sse/translator/index.js";

export function openAIChatRequestFixture() {
	return {
		messages: [
			{ role: "system", content: "System instructions." },
			{
				role: "user",
				content: [
					{ type: "text", text: "Describe the assets." },
					{
						type: "image_url",
						image_url: { url: "data:image/png;base64,SU1H", detail: "high" },
					},
					{
						type: "image_url",
						image_url: { url: "https://example.test/image.png", detail: "low" },
					},
					{
						type: "file",
						file: {
							file_data: "data:application/pdf;base64,UERG",
							filename: "paper.pdf",
						},
					},
				],
			},
			{
				role: "assistant",
				content: "",
				tool_calls: [
					{
						id: "call_weather",
						type: "function",
						function: { name: "get_weather", arguments: '{"city":"BA"}' },
					},
				],
			},
			{ role: "tool", tool_call_id: "call_weather", content: "sunny" },
		],
		tools: [
			{
				type: "function",
				function: {
					name: "get_weather",
					description: "Get weather",
					parameters: {
						type: "object",
						properties: { city: { type: "string" } },
						required: ["city"],
					},
				},
			},
		],
		max_tokens: 4096,
		temperature: 0.2,
		top_p: 0.8,
		stop: ["END"],
		user: "user-123",
		parallel_tool_calls: false,
		response_format: {
			type: "json_schema",
			json_schema: {
				schema: {
					type: "object",
					properties: { answer: { type: "string" } },
					required: ["answer"],
				},
			},
		},
		reasoning_effort: "high",
	};
}

export function claudeRequestFixture() {
	return {
		system: [
			{
				type: "text",
				text: "x-anthropic-billing-header: skip-me\nClaude system.",
			},
		],
		messages: [
			{
				role: "user",
				content: [
					{ type: "text", text: "Look." },
					{
						type: "image",
						source: { type: "base64", media_type: "image/png", data: "SU1H" },
					},
					{
						type: "image",
						source: {
							type: "url",
							url: "https://example.test/claude-image.png",
						},
					},
					{
						type: "document",
						source: {
							type: "base64",
							media_type: "application/pdf",
							data: "RE9D",
							filename: "claude-doc.pdf",
						},
					},
				],
			},
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_1",
						name: "get_weather",
						input: { city: "BA" },
					},
					{ type: "tool_use", id: "toolu_2", name: "get_time", input: {} },
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_1",
						is_error: true,
						content: [
							{ type: "text", text: "sunny" },
							{
								type: "image",
								source: {
									type: "base64",
									media_type: "image/png",
									data: "VE9PTF9JTUc=",
								},
							},
						],
					},
				],
			},
		],
		tools: [
			{
				name: "get_weather",
				description: "Get weather",
				input_schema: {
					type: "object",
					properties: { city: { type: "string" } },
				},
			},
		],
		tool_choice: { type: "tool", name: "get_weather" },
		max_tokens: 2048,
		temperature: 0.4,
		top_p: 0.7,
		top_k: 42,
		stop_sequences: ["HALT"],
		metadata: { user_id: "claude-user-123" },
	};
}

export function responsesRequestFixture() {
	return {
		instructions: "Follow response API instructions.",
		input: [
			{
				type: "message",
				role: "user",
				content: [
					{ type: "input_text", text: "Hello" },
					{
						type: "input_image",
						image_url: "data:image/png;base64,SU1H",
						detail: "high",
					},
				],
			},
			{
				type: "reasoning",
				summary: [{ type: "summary_text", text: "reasoned" }],
			},
			{
				type: "function_call",
				call_id: "call_response",
				name: "lookup",
				arguments: '{"q":"x"}',
			},
			{
				type: "function_call_output",
				call_id: "call_response",
				output: "result",
			},
		],
		tools: [
			{
				type: "function",
				name: "lookup",
				description: "Lookup",
				parameters: { type: "object", properties: { q: { type: "string" } } },
			},
		],
		max_output_tokens: 321,
		reasoning: { effort: "medium" },
	};
}

export function openAIChatForResponsesFixture() {
	return {
		messages: [
			{ role: "system", content: "Chat system." },
			{
				role: "user",
				content: [
					{ type: "text", text: "Hi" },
					{
						type: "image_url",
						image_url: { url: "https://example.test/cat.png", detail: "low" },
					},
				],
			},
			{
				role: "assistant",
				content: null,
				tool_calls: [
					{
						id: "call_chat",
						type: "function",
						function: { name: "lookup", arguments: '{"q":"cat"}' },
					},
				],
			},
			{ role: "tool", tool_call_id: "call_chat", content: "cat result" },
		],
		tools: [
			{
				type: "function",
				function: {
					name: "lookup",
					description: "Lookup",
					parameters: { type: "object", properties: { q: { type: "string" } } },
				},
			},
		],
		reasoning_effort: "low",
		max_tokens: 123,
		temperature: 0.1,
	};
}

export const claudeStreamEvents = [
	{ type: "message_start", message: { id: "msg_1", model: "claude-opus-4-6" } },
	{
		type: "content_block_start",
		index: 0,
		content_block: { type: "thinking", thinking: "" },
	},
	{
		type: "content_block_delta",
		index: 0,
		delta: { type: "thinking_delta", thinking: "think" },
	},
	{ type: "content_block_stop", index: 0 },
	{
		type: "content_block_start",
		index: 1,
		content_block: { type: "redacted_thinking" },
	},
	{ type: "content_block_stop", index: 1 },
	{
		type: "content_block_start",
		index: 2,
		content_block: { type: "text", text: "" },
	},
	{
		type: "content_block_delta",
		index: 2,
		delta: { type: "text_delta", text: "Hello" },
	},
	{ type: "content_block_stop", index: 2 },
	{
		type: "content_block_start",
		index: 3,
		content_block: {
			type: "tool_use",
			id: "toolu_1",
			name: "get_weather",
			input: {},
		},
	},
	{
		type: "content_block_delta",
		index: 3,
		delta: { type: "input_json_delta", partial_json: '{"city":"BA"}' },
	},
	{ type: "content_block_stop", index: 3 },
	{
		type: "message_delta",
		delta: { stop_reason: "tool_use" },
		usage: {
			input_tokens: 10,
			output_tokens: 5,
			cache_read_input_tokens: 3,
			cache_creation_input_tokens: 2,
		},
	},
	{ type: "message_stop" },
];

export const claudeServerToolEvents = [
	{
		type: "message_start",
		message: { id: "msg_server", model: "claude-opus-4-6" },
	},
	{
		type: "content_block_start",
		index: 0,
		content_block: { type: "server_tool_use", name: "web_search" },
	},
	{
		type: "content_block_delta",
		index: 0,
		delta: { type: "input_json_delta", partial_json: '{"query":"x"}' },
	},
	{ type: "content_block_stop", index: 0 },
	{
		type: "message_delta",
		delta: { stop_reason: "end_turn" },
		usage: { input_tokens: 1, output_tokens: 1 },
	},
	{ type: "message_stop" },
];

export const openAIStreamEvents = [
	{
		id: "chatcmpl-1",
		model: "gpt-test",
		choices: [{ index: 0, delta: { role: "assistant" } }],
	},
	{
		id: "chatcmpl-1",
		model: "gpt-test",
		choices: [{ index: 0, delta: { reasoning_content: "plan" } }],
	},
	{
		id: "chatcmpl-1",
		model: "gpt-test",
		choices: [{ index: 0, delta: { content: "Answer" } }],
	},
	{
		id: "chatcmpl-1",
		model: "gpt-test",
		choices: [
			{
				index: 0,
				delta: {
					tool_calls: [
						{
							index: 0,
							id: "call_read",
							type: "function",
							function: { name: "Read", arguments: "" },
						},
					],
				},
			},
		],
	},
	{
		id: "chatcmpl-1",
		model: "gpt-test",
		choices: [
			{
				index: 0,
				delta: {
					tool_calls: [
						{
							index: 0,
							function: {
								arguments: '{"file_path":"a.txt","limit":"5000","offset":"-2"}',
							},
						},
					],
				},
			},
		],
	},
	{
		id: "chatcmpl-1",
		model: "gpt-test",
		choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
		usage: {
			prompt_tokens: 20,
			completion_tokens: 7,
			prompt_tokens_details: { cached_tokens: 3, cache_creation_tokens: 2 },
		},
	},
];

export const openAIContentFilterStreamEvents = [
	{
		id: "chatcmpl-filter",
		model: "gpt-test",
		choices: [{ index: 0, delta: { role: "assistant" } }],
	},
	{
		id: "chatcmpl-filter",
		model: "gpt-test",
		choices: [{ index: 0, delta: {}, finish_reason: "content_filter" }],
	},
];

export const responsesStreamEvents = [
	{ type: "response.output_text.delta", delta: "Hello" },
	{ type: "response.reasoning_summary_text.delta", delta: "thinking" },
	{
		type: "response.output_item.added",
		item: { type: "function_call", call_id: "call_resp", name: "lookup" },
	},
	{ type: "response.function_call_arguments.delta", delta: '{"q":"x"}' },
	{ type: "response.output_item.done", item: { type: "function_call" } },
	{
		type: "response.completed",
		response: {
			usage: {
				input_tokens: 11,
				output_tokens: 4,
				input_tokens_details: { cached_tokens: 2 },
			},
		},
	},
];

export const responsesCustomToolStreamEvents = [
	{
		type: "response.output_item.added",
		item: {
			type: "custom_tool_call",
			call_id: "call_custom",
			name: "custom_runner",
		},
	},
	{ type: "response.custom_tool_call_input.delta", delta: "payload" },
	{ type: "response.output_item.done", item: { type: "custom_tool_call" } },
	{
		type: "response.completed",
		response: { usage: { input_tokens: 1, output_tokens: 1 } },
	},
];

export function stripVolatile(value) {
	return JSON.parse(JSON.stringify(value), (key, val) => {
		if (key === "created" || key === "created_at" || key === "sequence_number")
			return 0;
		if (key === "id" && typeof val === "string") {
			return val
				.replace(/^chatcmpl-\d{10,}$/, "chatcmpl-<TS>")
				.replace(/^resp_chatcmpl-\d+$/, "resp_chatcmpl-<ID>")
				.replace(/^rs_resp_chatcmpl-.+$/, "rs_resp_chatcmpl-<ID>")
				.replace(/^msg_resp_chatcmpl-.+$/, "msg_resp_chatcmpl-<ID>");
		}
		if (typeof val === "string") {
			return val
				.replace(/^chatcmpl-\d{10,}$/, "chatcmpl-<TS>")
				.replace(/^resp_chatcmpl-\d+$/, "resp_chatcmpl-<ID>")
				.replace(/^rs_resp_chatcmpl-.+$/, "rs_resp_chatcmpl-<ID>")
				.replace(/^msg_resp_chatcmpl-.+$/, "msg_resp_chatcmpl-<ID>");
		}
		return val;
	});
}

export function runStream(targetFormat, sourceFormat, events) {
	const state = initState(sourceFormat);
	const all = [];
	for (const event of events) {
		const out = translateResponse(targetFormat, sourceFormat, event, state);
		if (Array.isArray(out)) all.push(...out);
		else if (out) all.push(out);
	}
	return stripVolatile(all);
}
