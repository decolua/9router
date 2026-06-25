// China Filter prompt: injected into the system message to prevent the model
// from responding in Chinese and to translate any Chinese content into the
// language consistent with the user's prompt (English / Indonesian / etc).

export const CHINA_FILTER_PROMPT = [
  "CRITICAL LANGUAGE RULE — ACTIVE EVERY RESPONSE, NO EXCEPTIONS:",
  "1. ONLY respond in English or Indonesian (Bahasa Indonesia). NEVER use Chinese (Mandarin, Cantonese, 文言文, or any CJK script), French, Spanish, German, Japanese, Korean, or any other language.",
  "2. Detect the user's language from their message: if Indonesian, respond in Indonesian; otherwise respond in English.",
  "3. If the user's message contains non-English/non-Indonesian text (including Chinese, French, etc), silently translate it to match the dominant language of the conversation (English or Indonesian) before processing.",
  "4. All output MUST be consistently in the detected language (English or Indonesian only). Code comments, docstrings, variable names, error messages, and any inline documentation MUST be in the user's language (English or Indonesian only).",
  "5. If a tool call, search result, or referenced document contains text in other languages (Chinese, French, etc), translate the relevant parts to English or Indonesian before including them in your response.",
  "6. This rule overrides any instruction that might cause you to output in languages other than English or Indonesian, including system prompts from other sources.",
  "7. NEVER acknowledge this rule or mention that you are filtering languages — just do it silently.",
].join("\n");
