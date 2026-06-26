/**
 * ElevenLabs usage handler — character credits for the connected account.
 * Uses GET /v1/user/subscription (requires the key's user_read permission).
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";

const SUBSCRIPTION_URL = "https://api.elevenlabs.io/v1/user/subscription";

export async function getElevenLabsUsage(apiKey, proxyOptions = null) {
  if (!apiKey) return { message: "ElevenLabs API key not available." };

  try {
    const res = await proxyAwareFetch(SUBSCRIPTION_URL, {
      method: "GET",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    }, proxyOptions);

    if (res.status === 401) {
      // Restricted keys can lack user_read even though TTS works.
      return { message: "ElevenLabs connected. Key lacks user_read permission to read credits." };
    }
    if (!res.ok) {
      return { message: `ElevenLabs connected. Usage endpoint error (${res.status}).` };
    }

    const d = await res.json();
    const total = Math.max(0, Number(d.character_limit) || 0);
    const used = Math.min(Math.max(0, Number(d.character_count) || 0), total || Number.MAX_SAFE_INTEGER);
    const remaining = Math.max(total - used, 0);
    const resetAt = d.next_character_count_reset_unix
      ? new Date(Number(d.next_character_count_reset_unix) * 1000).toISOString()
      : null;
    const tier = String(d.tier || "").trim();
    const label = tier ? `${tier.charAt(0).toUpperCase()}${tier.slice(1)} characters` : "Characters";

    return {
      quotas: {
        [label]: {
          used,
          total,
          remaining,
          remainingPercentage: total > 0 ? Math.max(0, Math.min(100, (remaining / total) * 100)) : 0,
          resetAt,
          unlimited: total === 0,
        },
      },
    };
  } catch (error) {
    return { message: `ElevenLabs connected. Unable to fetch usage: ${error.message}` };
  }
}
