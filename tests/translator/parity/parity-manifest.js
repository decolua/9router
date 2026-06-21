// Single source of truth for PA-01 OpenAI<->Anthropic parity coverage.
// status:
// - translated: a request/response test must assert this id.
// - documented-loss: accepted loss with non-empty evidence citation.
// - unknown: unresolved parity policy decision; coverage gate must fail.
export const PARITY_MANIFEST = [
	// REQUEST — OpenAI Chat -> Claude
	{
		id: "req.oai_to_claude.model",
		direction: "request",
		leg: "openai->claude",
		status: "translated",
	},
	{
		id: "req.oai_to_claude.max_tokens",
		direction: "request",
		leg: "openai->claude",
		status: "translated",
	},
	{
		id: "req.oai_to_claude.stream",
		direction: "request",
		leg: "openai->claude",
		status: "translated",
	},
	{
		id: "req.oai_to_claude.temperature",
		direction: "request",
		leg: "openai->claude",
		status: "translated",
	},
	{
		id: "req.oai_to_claude.messages_text",
		direction: "request",
		leg: "openai->claude",
		status: "translated",
	},
	{
		id: "req.oai_to_claude.assistant_tool_calls_to_tool_use",
		direction: "request",
		leg: "openai->claude",
		status: "translated",
	},
	{
		id: "req.oai_to_claude.tool_role_to_tool_result",
		direction: "request",
		leg: "openai->claude",
		status: "translated",
	},
	{
		id: "req.oai_to_claude.image_data_uri",
		direction: "request",
		leg: "openai->claude",
		status: "translated",
	},
	{
		id: "req.oai_to_claude.image_http_url",
		direction: "request",
		leg: "openai->claude",
		status: "translated",
	},
	{
		id: "req.oai_to_claude.pdf_file_to_document",
		direction: "request",
		leg: "openai->claude",
		status: "translated",
	},
	{
		id: "req.oai_to_claude.tools",
		direction: "request",
		leg: "openai->claude",
		status: "translated",
	},
	{
		id: "req.oai_to_claude.tool_choice_auto_required_forced_none",
		direction: "request",
		leg: "openai->claude",
		status: "translated",
	},
	{
		id: "req.oai_to_claude.response_format_json",
		direction: "request",
		leg: "openai->claude",
		status: "translated",
	},
	{
		id: "req.oai_to_claude.reasoning_effort",
		direction: "request",
		leg: "openai->claude",
		status: "translated",
	},
	{
		id: "req.oai_to_claude.system",
		direction: "request",
		leg: "openai->claude",
		status: "translated",
	},
	{
		id: "req.oai_to_claude.top_p",
		direction: "request",
		leg: "openai->claude",
		status: "translated",
	},
	{
		id: "req.oai_to_claude.metadata_user",
		direction: "request",
		leg: "openai->claude",
		status: "translated",
	},
	{
		id: "req.oai_to_claude.stop",
		direction: "request",
		leg: "openai->claude",
		status: "translated",
	},
	{
		id: "req.oai_to_claude.parallel_tool_calls",
		direction: "request",
		leg: "openai->claude",
		status: "translated",
	},
	{
		id: "req.oai_to_claude.non_pdf_file_input_audio_audio_url",
		direction: "request",
		leg: "openai->claude",
		status: "documented-loss",
		reason:
			"PA-01 planner marks non-PDF file, input_audio, and audio_url as no-Claude-equivalent losses; openai-to-claude.js only emits document for application/pdf and has no audio target block.",
	},
	{
		id: "req.oai_to_claude.n_seed_logprobs_penalties_logit_bias",
		direction: "request",
		leg: "openai->claude",
		status: "documented-loss",
		reason:
			"PA-01 planner marks n, seed, logprobs, penalties, and logit_bias as no-Claude-equivalent losses.",
	},

	// REQUEST — Claude -> OpenAI Chat
	{
		id: "req.claude_to_oai.model",
		direction: "request",
		leg: "claude->openai",
		status: "translated",
	},
	{
		id: "req.claude_to_oai.max_tokens",
		direction: "request",
		leg: "claude->openai",
		status: "translated",
	},
	{
		id: "req.claude_to_oai.temperature",
		direction: "request",
		leg: "claude->openai",
		status: "translated",
	},
	{
		id: "req.claude_to_oai.system_and_billing_strip",
		direction: "request",
		leg: "claude->openai",
		status: "translated",
	},
	{
		id: "req.claude_to_oai.tool_use_to_tool_calls",
		direction: "request",
		leg: "claude->openai",
		status: "translated",
	},
	{
		id: "req.claude_to_oai.tool_result_to_tool_message",
		direction: "request",
		leg: "claude->openai",
		status: "translated",
	},
	{
		id: "req.claude_to_oai.fix_missing_tool_responses",
		direction: "request",
		leg: "claude->openai",
		status: "translated",
	},
	{
		id: "req.claude_to_oai.image_base64",
		direction: "request",
		leg: "claude->openai",
		status: "translated",
	},
	{
		id: "req.claude_to_oai.tools",
		direction: "request",
		leg: "claude->openai",
		status: "translated",
	},
	{
		id: "req.claude_to_oai.tool_choice_auto_any_tool",
		direction: "request",
		leg: "claude->openai",
		status: "translated",
	},
	{
		id: "req.claude_to_oai.tool_result_is_error",
		direction: "request",
		leg: "claude->openai",
		status: "translated",
	},
	{
		id: "req.claude_to_oai.tool_result_image_blocks",
		direction: "request",
		leg: "claude->openai",
		status: "translated",
	},
	{
		id: "req.claude_to_oai.image_url_source",
		direction: "request",
		leg: "claude->openai",
		status: "translated",
	},
	{
		id: "req.claude_to_oai.document_block",
		direction: "request",
		leg: "claude->openai",
		status: "translated",
	},
	{
		id: "req.claude_to_oai.top_p",
		direction: "request",
		leg: "claude->openai",
		status: "translated",
	},
	{
		id: "req.claude_to_oai.stop_sequences",
		direction: "request",
		leg: "claude->openai",
		status: "translated",
	},
	{
		id: "req.claude_to_oai.metadata_user",
		direction: "request",
		leg: "claude->openai",
		status: "translated",
	},
	{
		id: "req.claude_to_oai.top_k",
		direction: "request",
		leg: "claude->openai",
		status: "documented-loss",
		reason:
			"PA-01 planner marks Claude top_k as a documented loss because OpenAI Chat Completions has no top_k equivalent.",
	},
	{
		id: "req.claude_to_oai.thinking_blocks_history",
		direction: "request",
		leg: "claude->openai",
		status: "documented-loss",
		reason:
			"PA-01 planner marks Claude history thinking blocks as filtered with signature lost; OpenAI chat has no native signed thinking-history block.",
	},

	// RESPONSE stream — Claude -> OpenAI
	{
		id: "resp.claude_to_oai.message_start_role",
		direction: "response",
		leg: "claude->openai",
		status: "translated",
	},
	{
		id: "resp.claude_to_oai.text_delta",
		direction: "response",
		leg: "claude->openai",
		status: "translated",
	},
	{
		id: "resp.claude_to_oai.thinking_delta",
		direction: "response",
		leg: "claude->openai",
		status: "translated",
	},
	{
		id: "resp.claude_to_oai.tool_use_to_tool_calls",
		direction: "response",
		leg: "claude->openai",
		status: "translated",
	},
	{
		id: "resp.claude_to_oai.input_json_delta",
		direction: "response",
		leg: "claude->openai",
		status: "translated",
	},
	{
		id: "resp.claude_to_oai.usage",
		direction: "response",
		leg: "claude->openai",
		status: "translated",
	},
	{
		id: "resp.claude_to_oai.finish_reason",
		direction: "response",
		leg: "claude->openai",
		status: "translated",
	},
	{
		id: "resp.claude_to_oai.server_tool_use",
		direction: "response",
		leg: "claude->openai",
		status: "documented-loss",
		reason:
			"PA-01 planner marks server_tool_use/web search as intentionally skipped; claude-to-openai.js explicitly skips server_tool_use blocks.",
	},
	{
		id: "resp.claude_to_oai.stop_sequence_value",
		direction: "response",
		leg: "claude->openai",
		status: "documented-loss",
		reason:
			"PA-01 planner marks Claude message_delta.stop_sequence matched value as a documented loss because OpenAI Chat Completions has no field for the matched stop sequence value.",
	},
	{
		id: "resp.claude_to_oai.redacted_thinking",
		direction: "response",
		leg: "claude->openai",
		status: "translated",
	},
	{
		id: "resp.claude_to_oai.thinking_signature",
		direction: "response",
		leg: "claude->openai",
		status: "documented-loss",
		reason:
			"PA-01 planner marks Claude thinking signature as a documented loss because OpenAI reasoning_content has no signature equivalent.",
	},

	// RESPONSE stream — OpenAI -> Claude
	{
		id: "resp.oai_to_claude.message_start",
		direction: "response",
		leg: "openai->claude",
		status: "translated",
	},
	{
		id: "resp.oai_to_claude.content_to_text",
		direction: "response",
		leg: "openai->claude",
		status: "translated",
	},
	{
		id: "resp.oai_to_claude.reasoning_to_thinking",
		direction: "response",
		leg: "openai->claude",
		status: "translated",
	},
	{
		id: "resp.oai_to_claude.tool_calls_buffered",
		direction: "response",
		leg: "openai->claude",
		status: "translated",
	},
	{
		id: "resp.oai_to_claude.usage_cache_split",
		direction: "response",
		leg: "openai->claude",
		status: "translated",
	},
	{
		id: "resp.oai_to_claude.finish_reason",
		direction: "response",
		leg: "openai->claude",
		status: "translated",
	},
	{
		id: "resp.oai_to_claude.content_filter",
		direction: "response",
		leg: "openai->claude",
		status: "translated",
	},
	{
		id: "resp.oai_to_claude.thinking_signature",
		direction: "response",
		leg: "openai->claude",
		status: "translated",
	},

	// OpenAI Responses <-> Chat request/response pivot leg
	{
		id: "req.responses_to_chat.input_items_to_messages",
		direction: "request",
		leg: "openai-responses->openai",
		status: "translated",
	},
	{
		id: "req.responses_to_chat.instructions_to_system",
		direction: "request",
		leg: "openai-responses->openai",
		status: "translated",
	},
	{
		id: "req.responses_to_chat.function_call_to_tool_calls",
		direction: "request",
		leg: "openai-responses->openai",
		status: "translated",
	},
	{
		id: "req.responses_to_chat.function_call_output_to_tool",
		direction: "request",
		leg: "openai-responses->openai",
		status: "translated",
	},
	{
		id: "req.responses_to_chat.reasoning_to_reasoning_content",
		direction: "request",
		leg: "openai-responses->openai",
		status: "translated",
	},
	{
		id: "req.responses_to_chat.input_image_to_image_url",
		direction: "request",
		leg: "openai-responses->openai",
		status: "translated",
	},
	{
		id: "req.responses_to_chat.max_output_tokens_to_max_tokens",
		direction: "request",
		leg: "openai-responses->openai",
		status: "translated",
	},
	{
		id: "req.responses_to_chat.reasoning_effort",
		direction: "request",
		leg: "openai-responses->openai",
		status: "translated",
	},
	{
		id: "req.chat_to_responses.messages_to_input",
		direction: "request",
		leg: "openai->openai-responses",
		status: "translated",
	},
	{
		id: "req.chat_to_responses.system_to_instructions",
		direction: "request",
		leg: "openai->openai-responses",
		status: "translated",
	},
	{
		id: "req.chat_to_responses.tool_calls_to_function_call",
		direction: "request",
		leg: "openai->openai-responses",
		status: "translated",
	},
	{
		id: "req.chat_to_responses.tool_message_to_function_call_output",
		direction: "request",
		leg: "openai->openai-responses",
		status: "translated",
	},
	{
		id: "req.chat_to_responses.reasoning_effort",
		direction: "request",
		leg: "openai->openai-responses",
		status: "translated",
	},
	{
		id: "req.chat_to_responses.image_url_to_input_image",
		direction: "request",
		leg: "openai->openai-responses",
		status: "translated",
	},
	{
		id: "resp.responses_to_chat.text_reasoning_tool_usage",
		direction: "response",
		leg: "openai-responses->openai",
		status: "translated",
	},
	{
		id: "resp.responses_to_chat.custom_tool_call",
		direction: "response",
		leg: "openai-responses->openai",
		status: "translated",
	},
	{
		id: "resp.chat_to_responses.text_reasoning_tool_completed",
		direction: "response",
		leg: "openai->openai-responses",
		status: "translated",
	},
];

export function manifestIdsByStatus(status) {
	return PARITY_MANIFEST.filter((entry) => entry.status === status).map(
		(entry) => entry.id,
	);
}
