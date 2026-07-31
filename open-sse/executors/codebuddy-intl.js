import { DefaultExecutor } from "./default.js";
import { sanitizeChatBody } from "../protocol/codebuddy/index.js";

/**
 * CodeBuddy Intl uses the shared stream and reasoning rules while preserving
 * its broader OpenAI-compatible request body.
 */
export class CodeBuddyIntlExecutor extends DefaultExecutor {
  constructor() {
    super("codebuddy-intl");
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    return sanitizeChatBody(transformed && typeof transformed === "object" ? transformed : body, {
      preserveUnknownFields: true,
    });
  }
}

