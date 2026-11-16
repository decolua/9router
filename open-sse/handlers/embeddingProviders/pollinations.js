import { pollinationsHeaders } from "../../services/pollinationsModels.js";

function validatePart(part) {
  if (!part || typeof part !== "object" || Array.isArray(part)) throw new Error("Invalid Pollinations embedding content part");
  if (part.type === "text" && typeof part.text === "string") return;
  if (["image_url", "video_url"].includes(part.type) && typeof part[part.type]?.url === "string" && /^(https?:\/\/|data:)/i.test(part[part.type].url)) return;
  if (part.type === "input_audio" && typeof part.input_audio?.data === "string" && part.input_audio.data && typeof part.input_audio.format === "string" && part.input_audio.format) return;
  throw new Error("Invalid Pollinations embedding content part");
}

export default {
  buildUrl: () => "https://gen.pollinations.ai/v1/embeddings",
  buildHeaders: (credentials) => ({ "Content-Type": "application/json", ...pollinationsHeaders(credentials) }),
  buildBody(model, { input, dimensions, encoding_format, input_type, task_type }) {
    if (Array.isArray(input) && input.every((item) => typeof item === "string") && input.length > 32) throw new Error("Pollinations embedding batches support at most 32 strings");
    if (typeof input !== "string") {
      if (Array.isArray(input)) {
        if (!input.length) throw new Error("Pollinations embedding input cannot be empty");
        if (!input.every((item) => typeof item === "string")) input.forEach(validatePart);
      } else validatePart(input);
    }
    if (encoding_format !== undefined && !["float", "base64"].includes(encoding_format)) throw new Error("Invalid Pollinations embedding encoding_format");
    if (input_type !== undefined && !["query", "document"].includes(input_type)) throw new Error("Pollinations input_type must be query or document");
    const body = { model, input };
    if (encoding_format !== undefined) body.encoding_format = encoding_format;
    if (dimensions !== undefined && dimensions !== "") {
      const value = Number(dimensions);
      if (!Number.isInteger(value) || value < 128 || value > 4096) throw new Error("Pollinations embedding dimensions must be an integer between 128 and 4096; model-specific limits also apply");
      body.dimensions = value;
    }
    if (input_type !== undefined) body.input_type = input_type;
    if (task_type !== undefined) body.task_type = task_type;
    return body;
  },
  normalize: (body) => body,
};
