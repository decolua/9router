import { getAlicodeUsage } from "./usage.js";
import { isDiepXuanEnabled } from "../../../src/diepxuan/shared/config/flags.js";

export async function getDiepXuanUsageForProvider(connection, proxyOptions = null) {
  if (!isDiepXuanEnabled()) return null;
  const { provider, apiKey } = connection;

  switch (provider) {
    case "alicode":
    case "alicode-intl":
      return await getAlicodeUsage(apiKey, provider, proxyOptions);
    default:
      return null;
  }
}