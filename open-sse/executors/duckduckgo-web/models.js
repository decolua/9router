export const FE_VERSION_PATTERN = /serp_\d{8}_\d{6}_[A-Z]{2}-[0-9a-f]{20,40}/;
export const DUCKDUCKGO_DEFAULT_MODEL = "gpt-5.4-mini";
export const DUCKDUCKGO_MODEL_ALIASES = {
    "gpt-4o-mini": "gpt-5.4-mini",
    "gpt-5-mini": "gpt-5.4-mini",
    "o3-mini": "gpt-5.4-mini",
    "gpt-5.4-nano": "gpt-5.4-mini",
    "llama-4-scout": "gpt-5.4-mini",
    "claude-3-5-haiku-20241022": "claude-haiku-4-5",
    "mistral-small-2501": "mistral-small-2603",
    "gpt-oss-120b": "tinfoil/gpt-oss-120b",
    "gemma4-31b": "tinfoil/gemma4-31b"
};
export function normalizeDuckDuckGoModel(model) {
    if (!model) return DUCKDUCKGO_DEFAULT_MODEL;
    const clean = model.startsWith("duckduckgo-web/") ? model.slice("duckduckgo-web/".length) : model;
    return DUCKDUCKGO_MODEL_ALIASES[clean] ?? clean;
}
export function pickDuckDuckGoModel(requested, liveIds) {
    if (!liveIds || liveIds.size === 0) return requested;
    if (liveIds.has(requested)) return requested;
    const aliased = DUCKDUCKGO_MODEL_ALIASES[requested] ?? requested;
    return liveIds.has(aliased) ? aliased : DUCKDUCKGO_DEFAULT_MODEL;
}
export function extractFreeDuckDuckGoModelIds(value) {
    if (!value || typeof value !== "object") return new Set();
    const models = value.models;
    if (!Array.isArray(models)) return new Set();
    return new Set(models.filter((model)=>{
        if (!model || typeof model !== "object") return false;
        const tiers = model.accessTier;
        return Array.isArray(tiers) && tiers.some((tier)=>tier === "free");
    }).map((model)=>String(model.id ?? "")).filter(Boolean));
}
