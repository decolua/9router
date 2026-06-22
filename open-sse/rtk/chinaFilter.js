// China Filter injector: appends the anti-Chinese-language instruction into the
// system message of the final request body, just before dispatch to the provider
// executor. Follows the same pattern as caveman.js and ponytail.js.

import { injectSystemPrompt } from "./systemInject.js";
import { CHINA_FILTER_PROMPT } from "./chinaFilterPrompt.js";

export function injectChinaFilter(body, format) {
  injectSystemPrompt(body, format, CHINA_FILTER_PROMPT);
}
