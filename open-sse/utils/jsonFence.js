/**
 * Providers that get Structured Output as a prompt instruction (Claude-backed ones
 * especially) tend to answer with the JSON wrapped in a ```json fence. Clients that
 * JSON.parse the content — anything using schema-parsed calls — choke on it.
 * Strip the fence, but only when the request actually asked for JSON output.
 */

// Whole content is one fenced block: ```json\n{...}\n```
const FENCED_JSON = /^\s*```(?:json|JSON)?\s*\r?\n([\s\S]*?)\r?\n?\s*```\s*$/;

export function wantsJsonOutput(body) {
  const type = body?.response_format?.type;
  return type === "json_schema" || type === "json_object";
}

export function stripJsonFence(content) {
  if (typeof content !== "string") return content;
  const match = content.match(FENCED_JSON);
  return match ? match[1].trim() : content;
}

/**
 * Unfence the assistant content of an OpenAI-shaped response, in place.
 * ponytail: non-streaming only — a streaming client would need the fence stripped
 * across chunk boundaries; add a stateful transform if that ever comes up.
 */
export function unfenceJsonChoices(body, response) {
  if (!wantsJsonOutput(body) || !Array.isArray(response?.choices)) return response;
  for (const choice of response.choices) {
    const message = choice?.message;
    if (message) message.content = stripJsonFence(message.content);
  }
  return response;
}
