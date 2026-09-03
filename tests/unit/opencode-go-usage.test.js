import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";
import { USAGE_SUPPORTED_PROVIDERS, USAGE_APIKEY_PROVIDERS } from "../../src/shared/constants/providers.js";
import {
  parseQuotaData,
  getRemainingPercentage,
} from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";
import {
  OPENCODE_GO_USAGE_URL,
  isOpenCodeGoCreditsError,
  parseOpenCodeGoUsage,
} from "../../open-sse/services/usage/opencode-go.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Verbatim response from GET /zen/go/v1/usage on 2026-08-12, from a key whose
// monthly window was spent while the other two were untouched.
const LIVE_PAYLOAD = {
  usage: {
    rolling: { status: "ok", percent: 0, resetsAt: "2026-08-12T09:43:25.596Z" },
    weekly: { status: "ok", percent: 0, resetsAt: "2026-08-17T00:00:00.596Z" },
    monthly: { status: "rate-limited", percent: 100, resetsAt: "2026-08-12T19:57:51.596Z" },
  },
};

describe("opencode-go registry wiring", () => {
  it("carries the usage URL on the registry entry, not only in the handler", () => {
    // Asserted on PROVIDERS rather than the exported constant: the constant has a
    // hardcoded fallback, so it would still read correct with the registry block
    // deleted, and the dashboard resolves the provider through PROVIDERS.
    expect(PROVIDERS["opencode-go"].usage?.url).toBe("https://opencode.ai/zen/go/v1/usage");
    expect(OPENCODE_GO_USAGE_URL).toBe(PROVIDERS["opencode-go"].usage.url);
  });

  it("exposes usage + usageApikey so the API-key card appears on /usage", () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("opencode-go");
    expect(USAGE_APIKEY_PROVIDERS).toContain("opencode-go");
  });
});

describe("parseOpenCodeGoUsage", () => {
  it("reads percent as percent USED, not remaining", () => {
    const { quotas } = parseOpenCodeGoUsage(LIVE_PAYLOAD);

    expect(quotas.Monthly.used).toBe(100);
    expect(quotas.Monthly.remainingPercentage).toBe(0);
    expect(quotas.Rolling.used).toBe(0);
    expect(quotas.Rolling.remainingPercentage).toBe(100);
  });

  it("reports limitReached when any window is spent", () => {
    expect(parseOpenCodeGoUsage(LIVE_PAYLOAD).limitReached).toBe(true);
  });

  it("reports limitReached false when every window is healthy", () => {
    const healthy = {
      usage: {
        rolling: { status: "ok", percent: 0, resetsAt: "2026-08-12T09:43:25.596Z" },
        monthly: { status: "ok", percent: 40, resetsAt: "2026-08-12T19:57:51.596Z" },
      },
    };

    expect(parseOpenCodeGoUsage(healthy).limitReached).toBe(false);
  });

  it("treats a window at 100 percent as blocked even when status still reads ok", () => {
    const stale = { usage: { monthly: { status: "ok", percent: 100, resetsAt: "2026-08-12T19:57:51.596Z" } } };

    expect(parseOpenCodeGoUsage(stale).limitReached).toBe(true);
  });

  it("folds underscores and case in the status string", () => {
    // No percent field, so only the status signal can block this window.
    const renamed = { usage: { monthly: { status: "Rate_Limited", resetsAt: "2026-08-12T19:57:51.596Z" } } };

    expect(parseOpenCodeGoUsage(renamed).limitReached).toBe(true);
  });

  it("still blocks on the status signal when percent is missing", () => {
    const noPercent = { usage: { monthly: { status: "rate-limited", resetsAt: "2026-08-12T19:57:51.596Z" } } };
    const { quotas, limitReached } = parseOpenCodeGoUsage(noPercent);

    expect(limitReached).toBe(true);
    expect(quotas.Monthly.used).toBe(100);
  });

  it("hides the reset of an untouched window and surfaces it for a spent one", () => {
    const { quotas } = parseOpenCodeGoUsage(LIVE_PAYLOAD);

    // resetsAt on an idle window is a projection of now plus the window length,
    // not a deadline, so it must not render as a pending reset.
    expect(quotas.Rolling.resetAt).toBeNull();
    expect(quotas.Weekly.resetAt).toBeNull();
    expect(quotas.Monthly.resetAt).toBe("2026-08-12T19:57:51.596Z");
  });

  it("surfaces the reset of a partly used window", () => {
    const partial = { usage: { rolling: { status: "ok", percent: 35, resetsAt: "2026-08-12T09:43:25.596Z" } } };

    expect(parseOpenCodeGoUsage(partial).quotas.Rolling.resetAt).toBe("2026-08-12T09:43:25.596Z");
  });

  it("orders known windows rolling, weekly, monthly regardless of payload order", () => {
    const shuffled = {
      usage: {
        monthly: LIVE_PAYLOAD.usage.monthly,
        rolling: LIVE_PAYLOAD.usage.rolling,
        weekly: LIVE_PAYLOAD.usage.weekly,
      },
    };

    expect(Object.keys(parseOpenCodeGoUsage(shuffled).quotas)).toEqual(["Rolling", "Weekly", "Monthly"]);
  });

  it("appends an unrecognized window after the known ones", () => {
    const extra = {
      usage: {
        daily: { status: "ok", percent: 10, resetsAt: "2026-08-12T09:43:25.596Z" },
        rolling: LIVE_PAYLOAD.usage.rolling,
      },
    };
    const keys = Object.keys(parseOpenCodeGoUsage(extra).quotas);

    expect(keys).toEqual(["Rolling", "Daily"]);
  });

  it("skips a malformed window without losing its siblings", () => {
    const broken = { usage: { rolling: LIVE_PAYLOAD.usage.rolling, monthly: "not an object" } };
    const keys = Object.keys(parseOpenCodeGoUsage(broken).quotas);

    expect(keys).toEqual(["Rolling"]);
  });

  it("returns null when the payload carries no usable windows", () => {
    expect(parseOpenCodeGoUsage(null)).toBeNull();
    expect(parseOpenCodeGoUsage({})).toBeNull();
    expect(parseOpenCodeGoUsage({ usage: {} })).toBeNull();
    expect(parseOpenCodeGoUsage({ usage: [] })).toBeNull();
  });

  it("clamps a percent outside 0..100 so the bar cannot leave its track", () => {
    const odd = {
      usage: {
        rolling: { status: "ok", percent: -5, resetsAt: null },
        monthly: { status: "ok", percent: 140, resetsAt: "2026-08-12T19:57:51.596Z" },
      },
    };
    const { quotas } = parseOpenCodeGoUsage(odd);

    expect(quotas.Rolling.used).toBe(0);
    expect(quotas.Monthly.used).toBe(100);
  });
});

describe("getUsageForProvider(opencode-go)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls the usage endpoint with the chat API key as a bearer token", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(LIVE_PAYLOAD));

    const usage = await getUsageForProvider({ provider: "opencode-go", apiKey: "sk-test" });

    const [url, opts] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe("https://opencode.ai/zen/go/v1/usage");
    expect(opts.headers.Authorization).toBe("Bearer sk-test");
    expect(opts.method ?? "GET").toBe("GET");
    expect(usage.message).toBeUndefined();
    expect(usage.plan).toBe("OpenCode Go");
    expect(usage.limitReached).toBe(true);
  });

  it("reports an invalid key rather than empty quotas on 401", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ error: { type: "AuthError" } }, 401));

    const usage = await getUsageForProvider({ provider: "opencode-go", apiKey: "sk-bad" });

    expect(usage.quotas).toBeUndefined();
    expect(usage.message).toMatch(/invalid or expired/i);
  });

  it("reports a soft message rather than throwing when the fetch fails", async () => {
    proxyAwareFetch.mockRejectedValueOnce(new Error("socket hang up"));

    const usage = await getUsageForProvider({ provider: "opencode-go", apiKey: "sk-test" });

    expect(usage.message).toMatch(/socket hang up/);
  });

  it("says so when no key is stored on the connection", async () => {
    const usage = await getUsageForProvider({ provider: "opencode-go", apiKey: "" });

    expect(proxyAwareFetch).not.toHaveBeenCalled();
    expect(usage.message).toMatch(/not available/i);
  });
});

describe("dashboard rendering of opencode-go quotas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders one row per window with the remaining percentage the bar draws", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(LIVE_PAYLOAD));
    const usage = await getUsageForProvider({ provider: "opencode-go", apiKey: "sk-test" });

    // parseQuotaData has no opencode-go arm on purpose: its generic fallback
    // forwards used/total, and getRemainingPercentage derives the bar from those.
    // This asserts that path end to end rather than trusting it.
    const rows = parseQuotaData("opencode-go", usage);
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));

    expect(rows).toHaveLength(3);
    expect(getRemainingPercentage(byName.Rolling)).toBe(100);
    expect(getRemainingPercentage(byName.Weekly)).toBe(100);
    expect(getRemainingPercentage(byName.Monthly)).toBe(0);
    expect(byName.Monthly.resetAt).toBe("2026-08-12T19:57:51.596Z");
    expect(byName.Rolling.resetAt).toBeNull();
  });

  it("draws a partly used window at its true remaining percentage", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({ usage: { rolling: { status: "ok", percent: 35, resetsAt: "2026-08-12T09:43:25.596Z" } } }),
    );
    const usage = await getUsageForProvider({ provider: "opencode-go", apiKey: "sk-test" });

    const [row] = parseQuotaData("opencode-go", usage);
    expect(getRemainingPercentage(row)).toBe(65);
  });
});

describe("isOpenCodeGoCreditsError", () => {
  // Both bodies are verbatim from the live API on 2026-08-12, with the workspace
  // id in the CreditsError message replaced. Same status, same shape, opposite
  // meaning: only error.type separates a spent plan from a revoked key.
  const CREDITS =
    '{"type":"error","error":{"type":"CreditsError","message":"Insufficient balance. Manage your billing here: https://opencode.ai/workspace/wrk_test/billing"}}';
  const AUTH = '{"type":"error","error":{"type":"AuthError","message":"Invalid API key."}}';

  it("recognizes a spent plan window", () => {
    expect(isOpenCodeGoCreditsError(CREDITS)).toBe(true);
  });

  it("does not treat a revoked key as a spent plan", () => {
    expect(isOpenCodeGoCreditsError(AUTH)).toBe(false);
  });

  it("ignores prose and reads only the structural type", () => {
    // A body that mentions balance but carries no error.type must not decide this.
    expect(isOpenCodeGoCreditsError('{"message":"Insufficient balance."}')).toBe(false);
  });

  it("survives a non-JSON body", () => {
    expect(isOpenCodeGoCreditsError("<html>502 Bad Gateway</html>")).toBe(false);
    expect(isOpenCodeGoCreditsError("")).toBe(false);
  });
});
