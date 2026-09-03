/**
 * ElevenLabs usage handler — character credits for the connected account.
 * Uses GET /v1/user/subscription (requires the key's user_read permission).
 */

import { parseResetTime, toFiniteNumber, fetchWithTimeout } from "./shared.js";

const SUBSCRIPTION_URL = "https://api.elevenlabs.io/v1/user/subscription";

// Stable key so per-quota UI preferences survive a plan change; the tier only
// varies the human-facing label.
const QUOTA_KEY = "Characters";

export async function getElevenLabsUsage(apiKey, proxyOptions = null) {
  if (!apiKey) return { message: "ElevenLabs API key not available." };

  try {
    const res = await fetchWithTimeout(SUBSCRIPTION_URL, {
      method: "GET",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    }, 10000, proxyOptions);

    if (res.status === 401) {
      // Restricted keys can lack user_read even though TTS works.
      return { message: "ElevenLabs connected. Key lacks user_read permission to read credits." };
    }
    if (!res.ok) {
      return { message: `ElevenLabs connected. Usage endpoint error (${res.status}).` };
    }

    const d = await res.json();
    const total = Math.max(0, toFiniteNumber(d.character_limit));
    const used = Math.max(0, toFiniteNumber(d.character_count));
    const remaining = Math.max(total - used, 0);
    const tier = String(d.tier || "").trim();

    return {
      quotas: {
        [QUOTA_KEY]: {
          displayName: tier ? `${tier.charAt(0).toUpperCase()}${tier.slice(1)} characters` : QUOTA_KEY,
          used,
          total,
          remaining,
          // `remaining` is already clamped to [0, total], so this needs no further clamping.
          remainingPercentage: total > 0 ? (remaining / total) * 100 : 0,
          resetAt: parseResetTime(d.next_character_count_reset_unix),
          unlimited: total === 0,
        },
      },
    };
  } catch (error) {
    return { message: `ElevenLabs connected. Unable to fetch usage: ${error.message}` };
  }
}
