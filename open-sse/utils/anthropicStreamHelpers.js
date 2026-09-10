import { FORMATS } from "../translator/formats.js";
import { formatSSE } from "./streamHelpers.js";

const sharedEncoder = new TextEncoder();

export function formatIncompleteAnthropicStreamFailure() {
  return formatSSE({
    type: "error",
    error: {
      type: "api_error",
      message: "stream closed before message_stop"
    }
  }, FORMATS.CLAUDE);
}

export function buildAbortedAnthropicTerminalBytes() {
  return sharedEncoder.encode(formatIncompleteAnthropicStreamFailure());
}
