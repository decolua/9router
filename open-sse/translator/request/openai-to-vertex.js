import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { openaiToGeminiRequest } from "./openai-to-gemini.js";

/**
 * Post-process a Gemini-format body for Vertex AI compatibility:
 *
 * 1. Strip `id` from every `functionCall` and `functionResponse` part.
 *    Vertex AI rejects requests that include these fields.
 *
 * 2. Strip synthetic `thoughtSignature` parts injected by the base translator.
 *    Vertex rejects fake thought signatures in multi-turn tool-call history;
 *    only real signatures emitted by Vertex itself should be replayed.
 */
function stripVertexIncompatibleFields(body) {
  if (!body?.contents) return body;

  for (const turn of body.contents) {
    if (!Array.isArray(turn.parts)) continue;

    // Remove standalone synthetic thoughtSignature parts (text === "" with thoughtSignature)
    turn.parts = turn.parts.filter(
      p => !(p.thoughtSignature !== undefined && p.text === "" && !p.thought)
    );

    for (const part of turn.parts) {
      // Strip id from functionCall
      if (part.functionCall && "id" in part.functionCall) {
        delete part.functionCall.id;
      }
      // Strip id from functionResponse
      if (part.functionResponse && "id" in part.functionResponse) {
        delete part.functionResponse.id;
      }
      // Strip thoughtSignature injected alongside functionCall (synthetic signature)
      if (part.functionCall && "thoughtSignature" in part) {
        delete part.thoughtSignature;
      }
    }
  }

  return body;
}

export function openaiToVertexRequest(model, body, stream, credentials) {
  const gemini = openaiToGeminiRequest(model, body, stream, credentials);
  return stripVertexIncompatibleFields(gemini);
}

register(FORMATS.OPENAI, FORMATS.VERTEX, openaiToVertexRequest, null);
