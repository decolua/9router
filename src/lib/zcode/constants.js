/** Z.AI OAuth via ZCode CLI flow (chat.z.ai authorization server). */
export const ZCODE_ZAI_CLIENT_ID =
  process.env.ZCODE_ZAI_CLIENT_ID || "client_P8X5CMWmlaRO9gyO-KSqtg";

export const ZCODE_ZAI_CLIENT_SECRET = process.env.ZCODE_ZAI_CLIENT_SECRET || "";

export const ZCODE_ZAI_TOKEN_URL =
  process.env.ZCODE_ZAI_TOKEN_URL || "https://chat.z.ai/api/oauth/token";

/** Z.AI OAuth access_token lifetime when poll omits expires_in (~1h). */
export const ZCODE_ZAI_DEFAULT_EXPIRES_IN = 3600;

/** Upstream model IDs for Coding Plan (case-sensitive). */
export const GLM_CODING_PLAN_MODEL_MAP = {
  "glm-5.2": "GLM-5.2",
  "glm-5.1": "GLM-5.1",
  "glm-5-turbo": "GLM-5-Turbo",
  "glm-4.7": "GLM-4.7",
};