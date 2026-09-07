// Keep discovery, chat, images and connection probes on the same client version. GPT-5.6
// models require >= 0.144.0 in openai/codex's models-manager/models.json.
export const CODEX_CLIENT_VERSION = "0.144.6";
export const CODEX_USER_AGENT = `codex_cli_rs/${CODEX_CLIENT_VERSION}`;

export const CODEX_IMAGE_NO_RESULT_ERROR = "Codex completed without returning an image.";
export const CODEX_IMAGE_ERROR_TEXT_LIMIT = 1000;
