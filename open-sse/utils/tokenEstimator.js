/**
 * Token estimation utilities
 * Estimates token count from request bodies without making API calls
 */

// Rough estimate: ~4 characters per token (common approximation)
const CHARS_PER_TOKEN = 4;

/**
 * Estimate token count from a message content
 * @param {string|object|array} content - Message content
 * @returns {number} Estimated token count
 */
function estimateContentTokens(content) {
  if (!content) return 0;
  
  if (typeof content === "string") {
    return Math.ceil(content.length / CHARS_PER_TOKEN);
  }
  
  if (Array.isArray(content)) {
    return content.reduce((sum, part) => sum + estimateContentTokens(part), 0);
  }
  
  if (typeof content === "object") {
    // Handle different content block types
    if (content.type === "text" && content.text) {
      return Math.ceil(content.text.length / CHARS_PER_TOKEN);
    }
    
    if (content.type === "image_url" || content.type === "image") {
      // Images are expensive - estimate based on detail level
      // Low detail: ~85 tokens
      // High detail: ~1000+ tokens (very rough)
      const detail = content.detail || content.image_url?.detail || "high";
      return detail === "low" ? 85 : 1000;
    }
    
    if (content.type === "tool_use" || content.type === "tool_result") {
      // Tool calls have overhead
      return 50 + estimateContentTokens(content.input || content.content);
    }
    
    // Generic object - serialize and estimate
    return Math.ceil(JSON.stringify(content).length / CHARS_PER_TOKEN);
  }
  
  return 0;
}

/**
 * Estimate tokens from a single message
 * @param {object} message - Message object with role and content
 * @returns {number} Estimated token count
 */
function estimateMessageTokens(message) {
  if (!message) return 0;
  
  // Each message has overhead (~4 tokens for role formatting)
  const roleOverhead = 4;
  
  const contentTokens = estimateContentTokens(message.content);
  
  // Handle tool messages specially
  if (message.tool_calls && Array.isArray(message.tool_calls)) {
    const toolCallTokens = message.tool_calls.reduce((sum, tc) => {
      return sum + 20 + Math.ceil(JSON.stringify(tc.function || tc).length / CHARS_PER_TOKEN);
    }, 0);
    return roleOverhead + contentTokens + toolCallTokens;
  }
  
  return roleOverhead + contentTokens;
}

/**
 * Estimate total input tokens from a request body
 * @param {object} body - Request body (OpenAI format)
 * @returns {number} Estimated token count
 */
export function estimateInputTokens(body) {
  if (!body) return 0;
  
  let total = 0;
  
  // Handle messages array (standard OpenAI format)
  if (body.messages && Array.isArray(body.messages)) {
    total = body.messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
  }
  
  // Handle input array (Claude format, some other providers)
  if (body.input && Array.isArray(body.input)) {
    total = body.input.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
  }
  
  // Handle contents array (Google Gemini format)
  if (body.contents && Array.isArray(body.contents)) {
    total = body.contents.reduce((sum, msg) => sum + estimateContentTokens(msg), 0);
  }
  
  // Add overhead for tools (if present)
  if (body.tools && Array.isArray(body.tools)) {
    total += body.tools.reduce((sum, tool) => {
      return sum + Math.ceil(JSON.stringify(tool).length / CHARS_PER_TOKEN);
    }, 0);
  }
  
  // Add overhead for system prompt
  if (body.system && typeof body.system === "string") {
    total += Math.ceil(body.system.length / CHARS_PER_TOKEN);
  }
  
  return total;
}

/**
 * Estimate tokens from a message array only (simpler version)
 * @param {array} messages - Array of messages
 * @returns {number} Estimated token count
 */
export function estimateMessageArrayTokens(messages) {
  if (!messages || !Array.isArray(messages)) return 0;
  
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}
