/**
 * Test-only imports for Qoder protocol primitives.
 * Production: prefer createProtocol / chat from index.js.
 */

export { qoderEncodeBody } from "./encoding.js";
export { buildCosyHeaders, generateMachineId } from "./cosy.js";
export { wrapQoderSSE, isSpecialToken } from "./sse.js";
export {
  normalizeMessages,
  buildQoderRequestBody,
  buildChatPayload,
  SHELL,
  resolveReasoningEffort,
} from "./body.js";
export {
  QODER_CHAT_URL_ENCODED,
  QODER_MODEL_LIST_URL,
  QODER_LOGIN_URL,
  QODER_DEVICE_TOKEN_URL,
  QODER_USERINFO_URL,
} from "./constants.js";
