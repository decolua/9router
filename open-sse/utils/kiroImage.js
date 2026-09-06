import jpeg from "jpeg-js";
import { PNG } from "pngjs";

// Ported from cpa-kiro-provider (ViceEye) internal/chat/converter.go
// normalizeImage/resizeNearest: only PNG and JPEG are decoded and re-encoded;
// any other format (or anything that fails to decode) passes through untouched
// and remains eligible for whole-image dropping downstream.
export const KIRO_MAX_IMAGE_DIMENSION = 2000;
const KIRO_MAX_DECODED_PIXELS = 64_000_000;
const KIRO_MAX_IMAGE_BASE64_BYTES = 5 * 1024 * 1024;

function imageFormat(format) {
  const raw = String(format || "").toLowerCase();
  const sub = raw.includes("/") ? raw.slice(raw.lastIndexOf("/") + 1) : raw;
  if (!sub || sub === "jpg") return "jpeg";
  return sub;
}

function decodeImageBytes(format, bytes) {
  try {
    if (format === "png") {
      const png = PNG.sync.read(bytes);
      return { width: png.width, height: png.height, data: png.data };
    }
    if (format === "jpeg") {
      const raw = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
      return { width: raw.width, height: raw.height, data: raw.data };
    }
  } catch {
    // Undecodable input passes through untouched, matching cpa-kiro-provider.
  }
  return null;
}

function encodeImageBytes(format, width, height, rgba) {
  try {
    if (format === "png") {
      const png = new PNG({ width, height });
      png.data = rgba;
      return PNG.sync.write(png);
    }
    return jpeg.encode({ data: rgba, width, height }, 75).data;
  } catch {
    return null;
  }
}

function resizeNearest(rgba, srcW, srcH, dstW, dstH) {
  const out = Buffer.alloc(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / dstH));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / dstW));
      const src = (sy * srcW + sx) * 4;
      const dst = (y * dstW + x) * 4;
      out[dst] = rgba[src];
      out[dst + 1] = rgba[src + 1];
      out[dst + 2] = rgba[src + 2];
      out[dst + 3] = rgba[src + 3];
    }
  }
  return out;
}

function base64ByteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

/**
 * Resize/re-encode one wire-format Kiro image ({ format, source: { bytes } }).
 * Returns a replacement with smaller base64, or the original reference when
 * nothing could be improved (undecodable format, oversized guards, or a
 * re-encode that is not smaller than the source without a resize).
 */
export function shrinkKiroImage(image) {
  if (!image || typeof image !== "object") return image;
  let data = image.source?.bytes;
  if (typeof data !== "string" || !data) return image;
  if (data.startsWith("data:")) {
    const comma = data.indexOf(",");
    if (comma < 0) return image;
    data = data.slice(comma + 1);
  }
  if (base64ByteLength(data) > KIRO_MAX_IMAGE_BASE64_BYTES) return image;

  const format = imageFormat(image.format);
  let bytes;
  try {
    bytes = Buffer.from(data, "base64");
  } catch {
    return image;
  }
  if (!bytes || bytes.length === 0) return image;

  const decoded = decodeImageBytes(format, bytes);
  if (!decoded || decoded.width <= 0 || decoded.height <= 0) return image;
  if (decoded.width * decoded.height > KIRO_MAX_DECODED_PIXELS) return image;

  const maxDim = Math.max(decoded.width, decoded.height);
  let outW = decoded.width;
  let outH = decoded.height;
  let resized = false;
  if (maxDim > KIRO_MAX_IMAGE_DIMENSION) {
    const scale = KIRO_MAX_IMAGE_DIMENSION / maxDim;
    outW = Math.max(1, Math.floor(decoded.width * scale));
    outH = Math.max(1, Math.floor(decoded.height * scale));
    resized = true;
  }
  const rgba = resized
    ? resizeNearest(decoded.data, decoded.width, decoded.height, outW, outH)
    : decoded.data;
  const encodedFormat = format === "png" ? "png" : "jpeg";
  const encoded = encodeImageBytes(encodedFormat, outW, outH, rgba);
  if (!encoded) return image;

  const encodedBase64 = encoded.toString("base64");
  if (!resized && encodedBase64.length >= data.length) return image;
  return { format: encodedFormat, source: { bytes: encodedBase64 } };
}
