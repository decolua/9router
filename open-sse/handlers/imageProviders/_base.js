// Shared helpers for image provider adapters
import {
  decodeBase64Image,
  detectImageMime,
  fetchRemoteImage,
  fetchRemoteJson,
  readBoundedResponse,
  readBoundedJsonResponse,
  validateImageBuffer,
} from "../../utils/safeRemoteFetch.js";
import { MAX_IMAGE_BYTES } from "../../config/mediaConfig.js";

export const POLL_INTERVAL_MS = 1500;
export const POLL_TIMEOUT_MS = 120000;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Map OpenAI size to provider-specific aspect ratio
export function sizeToAspectRatio(size) {
  if (!size || typeof size !== "string") return "1:1";
  const map = {
    "1024x1024": "1:1",
    "1024x1792": "9:16",
    "1792x1024": "16:9",
    "1024x1536": "2:3",
    "1536x1024": "3:2",
  };
  return map[size] || "1:1";
}

// Fetch URL → base64 (for providers returning image URLs)
export async function urlToBase64(url, proxyOptions = null) {
  return (await fetchRemoteImage(url, { proxyOptions })).base64;
}

export async function readImageResponse(response) {
  return validateImageBuffer(await readBoundedResponse(response, MAX_IMAGE_BYTES));
}

export {
  decodeBase64Image,
  detectImageMime,
  fetchRemoteJson,
  readBoundedJsonResponse,
  validateImageBuffer,
};

export function nowSec() {
  return Math.floor(Date.now() / 1000);
}
