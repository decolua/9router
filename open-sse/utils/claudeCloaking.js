import { createHash, randomBytes } from "crypto";

const CLAUDE_VERSION = "2.1.63";

// Generate billing header matching real Claude Code format:
// x-anthropic-billing-header: cc_version=<ver>.<build>; cc_entrypoint=cli; cch=<hash>;
function generateBillingHeader(payload) {
  const content = JSON.stringify(payload);
  const cch = createHash("sha256").update(content).digest("hex").slice(0, 5);
  const buildHash = randomBytes(2).toString("hex").slice(0, 3);
  return `x-anthropic-billing-header: cc_version=${CLAUDE_VERSION}.${buildHash}; cc_entrypoint=cli; cch=${cch};`;
}

// Generate a random UUID v4
function generateFakeUserID() {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

/**
 * Apply Claude cloaking to request body:
 * 1. Inject billing header as first system block
 * 2. Inject fake user ID into metadata
 *
 * Only applies when using OAuth token (sk-ant-oat).
 * @param {object} body - Claude API request body
 * @param {string} apiKey - API key or OAuth token
 * @returns {object} Modified body
 */
export function applyCloaking(body, apiKey) {
  if (!apiKey || !apiKey.includes("sk-ant-oat")) return body;

  const result = { ...body };

  // Inject billing header as system[0], preserve existing system blocks
  const billingText = generateBillingHeader(body);
  const billingBlock = { type: "text", text: billingText };

  if (Array.isArray(result.system)) {
    // Skip if already injected
    if (!result.system[0]?.text?.startsWith("x-anthropic-billing-header:")) {
      result.system = [billingBlock, ...result.system];
    }
  } else if (typeof result.system === "string") {
    result.system = [billingBlock, { type: "text", text: result.system }];
  } else {
    result.system = [billingBlock];
  }

  // Inject fake user ID into metadata
  const existingUserId = result.metadata?.user_id;
  if (!existingUserId) {
    result.metadata = { ...result.metadata, user_id: generateFakeUserID() };
  }

  return result;
}
