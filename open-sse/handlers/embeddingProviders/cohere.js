import { Buffer } from "node:buffer";
import { bearerAuth } from "./_base.js";

const INPUT_TYPES = new Set(["search_document", "search_query", "classification", "clustering", "image"]);
const DIMENSIONS = {
  "embed-v4.0": [256, 512, 1024, 1536],
  "embed-v5.0-pro": [256, 512, 768, 1024, 1536, 2048],
  "embed-v5.0-fast": [256, 512, 768, 1024, 1536, 2048],
};

function imageBytes(url) {
  if (typeof url !== "string" || !/^data:image\/(?:jpeg|png|webp|gif);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(url)) {
    throw new Error("Cohere embedding images must be base64 JPEG, PNG, WebP or GIF data URIs");
  }
  const payload = url.slice(url.indexOf(",") + 1);
  if (!payload) throw new Error("Cohere embedding image data must not be empty");
  return Buffer.byteLength(payload, "base64");
}

export default {
  buildUrl: () => "https://api.cohere.com/v2/embed",
  buildHeaders: (credentials) => ({ "Content-Type": "application/json", ...bearerAuth(credentials) }),
  buildBody(model, { input, encoding_format = "float", dimensions, input_type = "search_document", truncate, max_tokens }, ctx = {}) {
    if (!["float", "base64"].includes(encoding_format)) throw new Error("encoding_format must be 'float' or 'base64'");
    if (!INPUT_TYPES.has(input_type)) throw new Error("Invalid Cohere input_type");
    const entries = typeof input === "string" ? [input] : input;
    if (!Array.isArray(entries) || entries.length === 0 || entries.length > 96) throw new Error("Cohere input must contain 1 to 96 strings or multimodal content objects");
    const body = { model, input_type, embedding_types: ["float"] };
    if (entries.every((entry) => typeof entry === "string")) {
      if (entries.some((entry) => entry.length === 0)) throw new Error("Cohere input strings must not be empty");
      body.texts = entries;
    } else {
      let bytes = 0;
      let imageCount = 0;
      let largestImage = 0;
      for (const entry of entries) {
        if (!Array.isArray(entry?.content) || !entry.content.length) throw new Error("Each multimodal input must have a nonempty content array");
        for (const part of entry.content) {
          if (part?.type === "image_url") {
            const size = imageBytes(part.image_url?.url);
            bytes += size;
            imageCount++;
            largestImage = Math.max(largestImage, size);
          } else if (part?.type !== "text" || typeof part.text !== "string" || !part.text.length) {
            throw new Error("Multimodal content must contain text or image_url parts");
          }
        }
      }
      if (bytes > 20 * 1024 * 1024) throw new Error("Cohere embedding images exceed the 20MB request limit");
      if (/v3\.0$/.test(model)) {
        if (entries.length !== 1 || entries[0].content.length !== 1 || imageCount !== 1 || largestImage > 5 * 1024 * 1024) {
          throw new Error("Embed v3 supports only one image up to 5MB and cannot mix text and images");
        }
        body.images = [entries[0].content[0].image_url.url];
        body.input_type = "image";
      } else {
        body.inputs = entries;
      }
    }
    if (dimensions != null) {
      if (!Number.isInteger(dimensions) || !DIMENSIONS[model]?.includes(dimensions)) {
        throw new Error(`Unsupported dimensions for ${model}`);
      }
      body.output_dimension = dimensions;
    }
    if (truncate != null) {
      if (!["NONE", "START", "END"].includes(truncate)) throw new Error("truncate must be NONE, START or END");
      body.truncate = truncate;
    }
    if (max_tokens != null) {
      if (!Number.isInteger(max_tokens) || max_tokens < 1) throw new Error("max_tokens must be a positive integer");
      body.max_tokens = max_tokens;
    }
    ctx.encodingFormat = encoding_format;
    ctx.embeddingCount = entries.length;
    return body;
  },
  normalize(response, model, ctx = {}) {
    const vectors = response?.embeddings?.float;
    if (!Array.isArray(vectors) || (ctx.embeddingCount != null && vectors.length !== ctx.embeddingCount)) throw new Error("Invalid Cohere embedding response count");
    const data = vectors.map((vector, index) => {
      if (!Array.isArray(vector) || !vector.length || vector.some((value) => typeof value !== "number" || !Number.isFinite(value))) throw new Error("Invalid Cohere embedding vector");
      let embedding = vector;
      if (ctx.encodingFormat === "base64") {
        const buffer = Buffer.allocUnsafe(vector.length * 4);
        for (let i = 0; i < vector.length; i++) buffer.writeFloatLE(vector[i], i * 4);
        embedding = buffer.toString("base64");
      }
      return { object: "embedding", index, embedding };
    });
    const billed = response.meta?.billed_units;
    const tokens = response.meta?.tokens?.input_tokens ?? billed?.input_tokens ?? ((billed?.text_tokens || 0) + (billed?.image_tokens || 0));
    return { object: "list", model, data, usage: { prompt_tokens: tokens, total_tokens: tokens } };
  },
};
