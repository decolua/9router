// Which model actually answered.
//
// A request names a combo alias ("odin"), not a model. The router then picks a
// member, and on failover picks another — so a single conversation can be served
// by several different models with nothing in the response saying so. Observed in
// session 17b4c03c: three models answered one thread (claude-opus-4-6-thinking,
// gemini-pro-default, deepseek-v4-pro) while the client displayed one alias
// throughout, and the reply claimed to be a fourth thing entirely.
//
// The alias is what was asked for. This header is what was delivered.

export const SERVING_MODEL_HEADER = "x-9r-serving-model";

// Header values must be ASCII and free of control characters, and a provider or
// model id is neither validated nor trusted here — it can come from a custom
// model registered against a provider node. Anything unsafe is dropped rather
// than sent, because a malformed header breaks the whole response.
function safeHeaderValue(value) {
  if (typeof value !== "string" || !value) return null;
  const cleaned = value.replace(/[^\x20-\x7E]/g, "").trim();
  return cleaned && cleaned.length <= 200 ? cleaned : null;
}

export function servingModelId(provider, model) {
  if (!model) return null;
  return safeHeaderValue(provider ? `${provider}/${model}` : model);
}

// Adds the header to a base set, leaving the base untouched when there is
// nothing trustworthy to report. `Access-Control-Expose-Headers` is required or
// a browser client cannot read it back off a CORS response.
export function withServingModel(baseHeaders, provider, model) {
  const id = servingModelId(provider, model);
  if (!id) return { ...baseHeaders };
  const exposed = baseHeaders["Access-Control-Allow-Origin"]
    ? { "Access-Control-Expose-Headers": SERVING_MODEL_HEADER }
    : {};
  return { ...baseHeaders, ...exposed, [SERVING_MODEL_HEADER]: id };
}
