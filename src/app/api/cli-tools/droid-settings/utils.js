// Check if settings has 9Router customModels
export const is9RouterConfig = (m, baseUrl = null) => {
  if (!m) return false;
  if (m.id?.startsWith("custom:9Router")) return true;
  return m.apiKey === "sk_9router" && typeof m.baseUrl === "string" && m.baseUrl.includes("/v1");
};
