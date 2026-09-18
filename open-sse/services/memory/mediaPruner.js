/**
 * Historical Media Pruner (Memory Optimization)
 *
 * In multi-turn chat interactions involving images, audio, or PDFs, large base64
 * data URIs or remote media blocks are repeatedly resent on every subsequent turn.
 * Once the assistant has processed and responded to a media turn, re-transmitting
 * multi-megabyte base64 strings consumes enormous token quotas and bandwidth.
 *
 * This module retains complete media content in the trailing user turn (the active question),
 * and replaces older historical media blocks with a lightweight textual placeholder:
 * `[Historical media: image (previously analyzed)]`.
 */

/**
 * Check if a content block is a media block
 * @param {Object} block
 * @returns {boolean}
 */
function isMediaBlock(block) {
  if (!block || typeof block !== "object") return false;
  const t = block.type;
  return (
    t === "image_url" ||
    t === "image" ||
    t === "input_image" ||
    t === "input_audio" ||
    t === "audio_url" ||
    t === "audio" ||
    t === "input_video" ||
    t === "video_url" ||
    t === "video" ||
    Boolean(block.inlineData?.mimeType) ||
    Boolean(block.fileData?.mimeType)
  );
}

/**
 * Prune historical media from earlier turns in the request body
 * @param {Object} body - Request body containing messages/contents/input
 * @param {Object} options
 * @param {boolean} options.enabled - Whether media pruning is enabled
 * @returns {{ body: Object, pruned: boolean, savedItems: number }}
 */
export function pruneHistoricalMedia(body, options = {}) {
  const { enabled = true } = options;

  if (!enabled || !body || typeof body !== "object") {
    return { body, pruned: false, savedItems: 0 };
  }

  const items = Array.isArray(body.messages)
    ? body.messages
    : Array.isArray(body.input)
    ? body.input
    : Array.isArray(body.contents)
    ? body.contents
    : null;

  if (!items || items.length <= 1) {
    return { body, pruned: false, savedItems: 0 };
  }

  // Find the start of the trailing user run (active turn).
  // Any messages before this index are considered historical.
  const isAssistant = (r) => r === "assistant" || r === "model";
  let lastAssistantIndex = -1;
  for (let i = items.length - 1; i >= 0; i--) {
    if (isAssistant(items[i]?.role)) {
      lastAssistantIndex = i;
      break;
    }
  }

  if (lastAssistantIndex < 0) {
    // No assistant turn yet (first turn); do not prune
    return { body, pruned: false, savedItems: 0 };
  }

  let savedItems = 0;

  // Process all historical items before lastAssistantIndex
  for (let i = 0; i <= lastAssistantIndex; i++) {
    const msg = items[i];
    if (!msg) continue;

    // 1. Clean message-level attachments/images
    if (Array.isArray(msg.images) && msg.images.length > 0) {
      savedItems += msg.images.length;
      msg.images = [];
      msg.content = `${typeof msg.content === "string" ? msg.content : ""}\n[Historical images removed by 9router memory optimizer]`.trim();
    }

    if (Array.isArray(msg.experimental_attachments) && msg.experimental_attachments.length > 0) {
      savedItems += msg.experimental_attachments.length;
      msg.experimental_attachments = [];
    }

    // 2. String content with data:image / data:audio URIs
    if (typeof msg.content === "string") {
      if (msg.content.includes("data:image/") || msg.content.includes("data:audio/")) {
        const replaced = msg.content.replace(/data:(image|audio|video)\/[a-zA-Z0-9.+_-]+;base64,[A-Za-z0-9+/=]+/g, "[Historical base64 media omitted by 9router]");
        if (replaced !== msg.content) {
          msg.content = replaced;
          savedItems++;
        }
      }
    }

    // 3. Array content blocks (OpenAI / Claude / Responses)
    if (Array.isArray(msg.content)) {
      const newContent = [];
      for (const block of msg.content) {
        if (isMediaBlock(block)) {
          savedItems++;
          const mediaType = block.type || "media";
          newContent.push({
            type: "text",
            text: `[Historical ${mediaType} omitted by 9router memory optimizer]`,
          });
        } else {
          newContent.push(block);
        }
      }
      msg.content = newContent;
    }

    // 4. Gemini parts array
    if (Array.isArray(msg.parts)) {
      const newParts = [];
      for (const part of msg.parts) {
        if (part?.inlineData || part?.fileData) {
          savedItems++;
          newParts.push({
            text: `[Historical media omitted by 9router memory optimizer]`,
          });
        } else {
          newParts.push(part);
        }
      }
      msg.parts = newParts;
    }
  }

  return {
    body,
    pruned: savedItems > 0,
    savedItems,
  };
}
