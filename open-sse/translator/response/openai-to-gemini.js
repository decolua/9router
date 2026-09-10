import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { openaiToAntigravityResponse } from "./openai-to-antigravity.js";

// Gemini-family streaming responses share the same response.candidates envelope here.
register(FORMATS.OPENAI, FORMATS.GEMINI, null, openaiToAntigravityResponse);
register(FORMATS.OPENAI, FORMATS.GEMINI_CLI, null, openaiToAntigravityResponse);
register(FORMATS.OPENAI, FORMATS.VERTEX, null, openaiToAntigravityResponse);
