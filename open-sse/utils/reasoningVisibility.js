import { REASONING_HEADER } from "../config/runtimeConfig.js";

// Whether reasoning_content should be dropped from a non-streaming OpenAI-format
// response.
//
// History: #517 stripped it unconditionally because one client (Firecrawl's AI SDK)
// had a JSON parser that rejected the non-standard field. That cost every other
// non-streaming client its thinking output, and #1836 already walked it back once by
// only stripping when `content` was non-empty. It is still a lossy default: the field
// is what DeepSeek/GLM/Qwen/Kimi/Hunyuan/Ollama all return natively, our own streaming
// path emits it, and Claude-format responses keep their thinking blocks — so an
// OpenAI-format client was the only one silently losing data.
//
// Default is now "keep". Clients that genuinely cannot parse it send
// `x-9router-reasoning: off`; a deployment fronting only such clients sets
// STRIP_REASONING_CONTENT=1.
export function shouldStripReasoningContent(clientRawRequest) {
  const header = clientRawRequest?.headers?.[REASONING_HEADER];
  if (typeof header === "string" && header.toLowerCase() === "off") return true;
  // Read at call time, not module load, so the env is honoured under test and after
  // a config reload.
  const env = process.env.STRIP_REASONING_CONTENT?.trim().toLowerCase();
  return env === "1" || env === "true" || env === "on" || env === "yes";
}

// Apply the opt-out in place. Never strips when `content` is empty — for a model that
// spent its whole budget on reasoning, reasoning_content is the only output there is.
export function applyReasoningVisibility(response, clientRawRequest) {
  if (!response?.choices) return response;
  if (!shouldStripReasoningContent(clientRawRequest)) return response;
  for (const choice of response.choices) {
    if (choice?.message?.reasoning_content && choice.message.content) {
      delete choice.message.reasoning_content;
    }
  }
  return response;
}
