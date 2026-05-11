import { createErrorResult } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";

const COMPACT_API_URL = "https://api.morphllm.com/v1/compact";

/**
 * Core Morph Compact handler — utility for compressing chat history.
 * Mirrors the embeddingsCore pattern (plain fetch, no SDK).
 *
 * @param {object} options
 * @param {Array<{role:string, content:string}>} options.messages
 * @param {string|null} options.query
 * @param {number|null} options.compressionRatio
 * @param {number|null} options.preserveRecent
 * @param {string} options.apiKey — Morph API key
 * @returns {Promise<{success:boolean, response?:Response, status?:number, error?:string}>}
 */
export async function handleCompactCore({
  messages,
  query = null,
  compressionRatio = null,
  preserveRecent = null,
  apiKey,
}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "messages[] is required");
  }
  if (!apiKey || typeof apiKey !== "string") {
    return createErrorResult(
      HTTP_STATUS.BAD_REQUEST,
      "Morph API key is required. Connect Morph provider in Dashboard."
    );
  }

  const requestBody = {
    messages,
    ...(query ? { query } : {}),
    ...(typeof compressionRatio === "number" ? { compressionRatio } : {}),
    ...(typeof preserveRecent === "number" ? { preserveRecent } : {}),
  };

  try {
    const res = await fetch(COMPACT_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return createErrorResult(
        res.status === 401 ? HTTP_STATUS.UNAUTHORIZED : HTTP_STATUS.BAD_GATEWAY,
        `Morph Compact API error ${res.status}: ${text.slice(0, 200)}`
      );
    }

    const data = await res.json();

    return {
      success: true,
      response: new Response(JSON.stringify({
        id: data.id,
        messages: data.messages,
        usage: data.usage,
      }), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }),
    };
  } catch (error) {
    console.error("[MORPH-COMPACT] Error:", error.message);
    return createErrorResult(
      HTTP_STATUS.BAD_GATEWAY,
      `Morph Compact failed: ${error.message}`
    );
  }
}
