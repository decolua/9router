// Nace Drex — decision models served on the System One protocol by console.nace.ai.
// Same request/response as the other /v1/systemone lanes: a state plus typed questions
// (noul / choice / score) in, calibrated probabilities out. The lane forwards the body and
// the JSON reply untouched, so a score answer's `legend` array and every `confidence` reach
// the client as Drex returns them. drex-max also reads a top-level `images` array (PNG, JPEG,
// WebP; up to 8 per request, inline base64/data URL or an uploaded workspace file); the
// text-only models answer 422 when that array is non-empty, so no image rewriting is done
// here. Catalog verified live 2026-10-26 via GET https://console.nace.ai/v1/models.
// Docs: https://console.nace.ai/docs/drex/guides/drex-max
export default {
  id: "nace",
  priority: 48,
  alias: "nace",
  aliases: ["drex"],
  uiAlias: "nace",
  display: {
    name: "Nace Drex",
    icon: "psychology",
    color: "#1D1D16",
    textIcon: "DX",
    website: "https://console.nace.ai",
    notice: {
      text: "Drex decision models on the System One protocol (noul / choice / score questions, calibrated probabilities). drex-max also accepts a top-level `images` array; drex-v2.0 is text-only. Paste a console.nace.ai API key (sent as a Bearer token).",
      apiKeyUrl: "https://console.nace.ai/dashboard/api-keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  models: [
    { id: "drex-max", name: "Drex Max", kind: "systemone" },
    { id: "drex-v2.0", name: "Drex 2.0", kind: "systemone" },
  ],
  serviceKinds: ["systemone"],
  systemoneConfig: {
    baseUrl: "https://console.nace.ai/v1/systemone",
    // A saved host (providerSpecificData.baseUrl) is joined with this path.
    path: "/v1/systemone",
    authType: "apikey",
    authHeader: "bearer",
  },
};
