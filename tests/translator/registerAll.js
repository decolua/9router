// Eagerly import every translator so register() side-effects run under ESM/vitest.
// translator/index.js uses require() (bundler-only) which no-ops in vitest → import directly.
import "../../open-sse/translator/request/claude-to-openai.js";
import "../../open-sse/translator/request/openai-to-claude.js";
import "../../open-sse/translator/request/gemini-to-openai.js";
import "../../open-sse/translator/request/openai-to-gemini.js";
import "../../open-sse/translator/request/openai-to-vertex.js";
import "../../open-sse/translator/request/antigravity-to-openai.js";
import "../../open-sse/translator/request/openai-responses.js";
import "../../open-sse/translator/request/openai-to-kiro.js";
import "../../open-sse/translator/request/openai-to-cursor.js";
import "../../open-sse/translator/request/openai-to-ollama.js";
import "../../open-sse/translator/request/openai-to-commandcode.js";
import "../../open-sse/translator/response/claude-to-openai.js";
import "../../open-sse/translator/response/openai-to-claude.js";
import "../../open-sse/translator/response/gemini-to-openai.js";
import "../../open-sse/translator/response/openai-to-antigravity.js";
import "../../open-sse/translator/response/openai-responses.js";
import "../../open-sse/translator/response/kiro-to-openai.js";
import "../../open-sse/translator/response/cursor-to-openai.js";
import "../../open-sse/translator/response/ollama-to-openai.js";
import "../../open-sse/translator/response/commandcode-to-openai.js";
