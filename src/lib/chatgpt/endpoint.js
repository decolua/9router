import { getSettings, getCombos, getModelAliases, validateApiKey } from "@/lib/localDb";
import { chatGPTManifest, selectedModels, codexModelId } from "./models";
import { prepareCompactionInput } from "./compact";
import { runChatGPTCompaction } from "./compactionRunner";
import { withChatGPTReasoning } from "./reasoning";

const headers = { "Cache-Control": "no-store" };
const jsonError = (message, status) => Response.json({ error: { message } }, { status, headers });

// This endpoint accepts only 9router credentials, even on loopback or when
// requireApiKey is disabled. Subscription credentials belong at the local bridge.
export async function authorizeChatGPT(request) {
  if (request.headers.has("chatgpt-account-id")) return null;
  const auth = request.headers.get("authorization") || "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return key && await validateApiKey(key) ? key : null;
}

export async function getChatGPTManifest(request) {
  if (!await authorizeChatGPT(request)) return jsonError("A valid 9router API key is required.", 401);
  const [settings, combos, aliases] = await Promise.all([getSettings(), getCombos(), getModelAliases()]);
  const models = await withChatGPTReasoning(selectedModels(settings), combos, aliases);
  return Response.json(chatGPTManifest(models), { headers });
}

export async function routeChatGPTResponse(request, handleChat, compact = false) {
  const key = await authorizeChatGPT(request);
  if (!key) return jsonError("A valid 9router API key is required.", 401);
  let body;
  try { body = await request.json(); }
  catch { return jsonError("Invalid JSON.", 400); }
  const models = selectedModels(await getSettings());
  const selected = models.find(model => codexModelId(model.id) === body?.model);
  if (!selected) return jsonError("Model is not enabled in ChatGPT settings. Refresh the integration and restart Codex.", 404);
  // Full Responses history is required when changing backends. An opaque OpenAI
  // response ID cannot be resolved by another provider.
  if (body.previous_response_id || body.input?.some?.(item => item?.type === "item_reference")) {
    return jsonError("This history references another backend. Start a new Codex task for this model.", 400);
  }
  let prepared;
  try { prepared = prepareCompactionInput(body, key); }
  catch (error) { return jsonError(error.message, 400); }
  const v2 = !compact && prepared.triggered;
  const stream = v2 && body.stream === true;
  body = { ...prepared.body, model: selected.id };
  const forwarded = new Headers({ "content-type": "application/json", authorization: `Bearer ${key}` });
  // Construct a fresh request; never copy account IDs, cookies or OAuth headers.
  const invoke = (payload, signal) => handleChat(new Request(request.url, {
    method: "POST", headers: forwarded, body: JSON.stringify(payload), signal,
  }));
  return compact || v2 ? runChatGPTCompaction({
    body, contextWindow: selected.contextWindow, invoke, signal: request.signal,
    apiKey: key, model: codexModelId(selected.id), v2, stream,
  }) : invoke(body, request.signal);
}
