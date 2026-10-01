import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { openaiToGeminiRequest } from "./openai-to-gemini.js";
import { DEFAULT_THINKING_VERTEX_SIGNATURE } from "../../config/defaultThinkingSignature.js";

/**
 * Post-process a Gemini-format body for Vertex AI compatibility:
 *
 * 1. Replace all synthetic thoughtSignatures with Vertex-native signature.
 * 2. Strip `id` from functionCall and functionResponse (Vertex rejects these).
 */
function postProcessForVertex(body) {
  if (!body?.contents) return body;

  for (const turn of body.contents) {
    if (!Array.isArray(turn.parts)) continue;

    for (const part of turn.parts) {
      // Replace any synthetic signature with Vertex-native one
      if (part.thoughtSignature !== undefined) {
        part.thoughtSignature = DEFAULT_THINKING_VERTEX_SIGNATURE;
      }
      // Strip id from functionCall
      if (part.functionCall && "id" in part.functionCall) {
        delete part.functionCall.id;
      }
      // Strip id from functionResponse
      if (part.functionResponse && "id" in part.functionResponse) {
        delete part.functionResponse.id;
      }
    }
  }

  return body;
}

export function openaiToVertexRequest(model, body, stream, credentials) {
  const gemini = openaiToGeminiRequest(model, body, stream, credentials);
  return postProcessForVertex(gemini);
}

register(FORMATS.OPENAI, FORMATS.VERTEX, openaiToVertexRequest, null);
