// Catalog ids are `vendor/name` (one slash), including first-party `llmtr/<name>`.
// Basic Chat treats a slash as `provider/model`, so a raw id would route to the
// vendor (or drop the `llmtr/` segment). Prefix the owning provider once.
// Ids that already have two slashes are left alone.
export function routeLlmtrModel(model) {
  const upstreamId = typeof model === "string" ? model : model?.id;
  if (typeof upstreamId !== "string" || !upstreamId) return model;
  const ops = typeof model === "object" ? model?.supported_operations : null;
  if (Array.isArray(ops) && ops.length > 0 && !ops.includes("CHAT_COMPLETIONS")) return null;
  if (upstreamId.split("/").length > 2) {
    return typeof model === "string" ? { id: model, upstreamModelId: model } : { ...model, upstreamModelId: upstreamId };
  }
  const id = `llmtr/${upstreamId}`;
  return typeof model === "string"
    ? { id, name: model, upstreamModelId: upstreamId }
    : { ...model, id, upstreamModelId: upstreamId };
}
