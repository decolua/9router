// Concern #6: finish_reason / stop_reason mapping.
// One entry per direction; switch by special format, default handles common providers.
import { OPENAI_FINISH, CLAUDE_STOP, GEMINI_FINISH } from "../schema/finishReasons.js";

// upstream finish/stop reason → OpenAI finish_reason
export function toOpenAIFinish(reason, format) {
  switch (format) {
    case "claude":
      switch (reason) {
        case CLAUDE_STOP.END_TURN: return OPENAI_FINISH.STOP;
        case CLAUDE_STOP.MAX_TOKENS: return OPENAI_FINISH.LENGTH;
        case CLAUDE_STOP.TOOL_USE: return OPENAI_FINISH.TOOL_CALLS;
        case CLAUDE_STOP.STOP_SEQUENCE: return OPENAI_FINISH.STOP;
        default: return OPENAI_FINISH.STOP;
      }
    case "commandcode":
      switch (reason) {
        case "stop": return OPENAI_FINISH.STOP;
        case "length": return OPENAI_FINISH.LENGTH;
        case "tool-calls":
        case "tool_use": return OPENAI_FINISH.TOOL_CALLS;
        case "content-filter": return OPENAI_FINISH.CONTENT_FILTER;
        case "error": return OPENAI_FINISH.STOP;
        default: return reason || OPENAI_FINISH.STOP;
      }
    case "gemini":
      switch (String(reason).toUpperCase()) {
        case GEMINI_FINISH.STOP: return OPENAI_FINISH.STOP;
        case GEMINI_FINISH.MAX_TOKENS: return OPENAI_FINISH.LENGTH;
        case GEMINI_FINISH.SAFETY:
        case GEMINI_FINISH.RECITATION:
        case GEMINI_FINISH.BLOCKLIST:
        case GEMINI_FINISH.PROHIBITED_CONTENT: return OPENAI_FINISH.CONTENT_FILTER;
        default: return OPENAI_FINISH.STOP;
      }
    case "kiro":
    case "ollama":
      switch (reason) {
        case "tool_calls":
        case "tool_use": return OPENAI_FINISH.TOOL_CALLS;
        case "length":
        case "max_tokens": return OPENAI_FINISH.LENGTH;
        default: return OPENAI_FINISH.STOP;
      }
    default:
      return reason || OPENAI_FINISH.STOP;
  }
}

// OpenAI finish_reason → upstream stop reason
export function fromOpenAIFinish(reason, format) {
  switch (format) {
    case "claude":
      switch (reason) {
        case OPENAI_FINISH.STOP: return CLAUDE_STOP.END_TURN;
        case OPENAI_FINISH.LENGTH: return CLAUDE_STOP.MAX_TOKENS;
        case OPENAI_FINISH.TOOL_CALLS: return CLAUDE_STOP.TOOL_USE;
        default: return CLAUDE_STOP.END_TURN;
      }
    default:
      return reason;
  }
}
