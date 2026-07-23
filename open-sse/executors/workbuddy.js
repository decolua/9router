import { DefaultExecutor } from "./default.js";

/**
 * WorkBuddyExecutor — talks to https://www.codebuddy.cn/v2/chat/completions
 *
 * WorkBuddy is a B2B/enterprise skin of CodeBuddy CN (same codebuddy.cn
 * OpenAI-compatible gateway). Behavior mirrors CodeBuddyExecutor:
 * gateway rejects non-stream requests, and reasoning must be surfaced via
 * OpenAI-style reasoning_effort + reasoning_summary:"auto" (vendor-native
 * thinking shapes are not honored by the unified gateway).
 */
export class WorkBuddyExecutor extends DefaultExecutor {
  constructor() {
    super("workbuddy");
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    transformed.stream = true;

    const eff = transformed.reasoning_effort;
    if (eff === "none" || eff === "off") {
      delete transformed.reasoning_effort;
    } else if (eff) {
      transformed.reasoning_summary = "auto";
    }
    return transformed;
  }
}

export default WorkBuddyExecutor;
