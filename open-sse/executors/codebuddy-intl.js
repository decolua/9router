import { CodeBuddyExecutor } from "./codebuddy-cn.js";

/**
 * Tencent CodeBuddy International Executor (www.codebuddy.ai)
 * Shares channel verification headers, system prompt normalization, error parsing,
 * and OAuth token refresh with CodeBuddyExecutor.
 */
export class CodeBuddyIntlExecutor extends CodeBuddyExecutor {
  constructor() {
    super("codebuddy-intl");
  }
}

export default CodeBuddyIntlExecutor;
