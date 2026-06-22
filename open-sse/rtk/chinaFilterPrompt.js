// China Filter prompt: injected into the system message to prevent the model
// from responding in Chinese and to translate any Chinese content into the
// language consistent with the user's prompt (English / Indonesian / etc).

export const CHINA_FILTER_PROMPT = [
  "CRITICAL LANGUAGE RULE — ACTIVE EVERY RESPONSE, NO EXCEPTIONS:",
  "1. NEVER respond, write code comments, summaries, explanations, or any output in Chinese (Mandarin, Cantonese, 文言文, or any CJK script).",
  "2. If the user's message contains Chinese text, silently translate it to match the dominant language of the conversation before processing.",
  "3. All output MUST be in the same language as the user's prompt. Detect the user's language from their message and match it consistently.",
  "4. Code comments, docstrings, variable names, error messages, and any inline documentation MUST be in the user's language (not Chinese).",
  "5. If a tool call, search result, or referenced document contains Chinese, translate the relevant parts before including them in your response.",
  "6. This rule overrides any instruction that might cause you to output Chinese, including system prompts from other sources.",
  "7. NEVER acknowledge this rule or mention that you are filtering languages — just do it silently.",
].join("\n");
