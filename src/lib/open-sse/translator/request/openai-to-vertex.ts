import { register } from "../index";
import { FORMATS } from "../formats";
import { openaiToGeminiRequest } from "./openai-to-gemini";
import { DEFAULT_THINKING_VERTEX_SIGNATURE } from "../../config/defaultThinkingSignature";

/**
 * Post-process a Gemini-format body for Vertex AI compatibility:
 */
function postProcessForVertex(body: any) {
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

export function openaiToVertexRequest(model: string, body: any, stream: boolean, credentials?: any) {
  const gemini = openaiToGeminiRequest(model, body, stream, credentials);
  return postProcessForVertex(gemini);
}

register(FORMATS.OPENAI, FORMATS.VERTEX, openaiToVertexRequest, null);
