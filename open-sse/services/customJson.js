import { CustomJsonExecutor } from "../executors/custom-json.js";

export async function probeCustomJsonEndpoint(node, apiKey, model = "custom", proxyOptions = null) {
  try {
    const { response } = await new CustomJsonExecutor(node.id || "custom-json-check").execute({
      model, stream: false, proxyOptions,
      body: { model, messages: [{ role: "user", content: "ping" }], stream: false },
      credentials: { apiKey, providerSpecificData: { baseUrl: node.baseUrl, customJson: node.customJson } },
    });
    if (!response.ok) {
      const detail = await response.text();
      return { valid: false, error: `Custom JSON request failed (${response.status}): ${detail.slice(0, 300)}` };
    }
    return { valid: true, method: "custom-json" };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}
