import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getDashboardConnectionStatus,
  getStatusDisplayItems,
} from "../../src/app/(dashboard)/dashboard/providers/statusDisplay.js";

const providerConnections = [];
const providerNodes = [];

const getProviderConnections = vi.fn(async () => providerConnections);
const getProviderNodes = vi.fn(async () => providerNodes);

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    }),
  },
}));

vi.mock("@/models", () => ({
  getProviderConnections,
  createProviderConnection: vi.fn(),
  getProviderNodeById: vi.fn(async () => null),
  getProviderNodes,
  getProxyPoolById: vi.fn(async () => null),
}));

vi.mock("@/shared/constants/config", () => ({
  APIKEY_PROVIDERS: {},
}));

vi.mock("@/shared/constants/providers", () => ({
  FREE_TIER_PROVIDERS: {},
  WEB_COOKIE_PROVIDERS: {},
  isOpenAICompatibleProvider: () => false,
  isAnthropicCompatibleProvider: () => false,
}));

vi.mock("@/lib/localDb", () => ({
  getConnectionStatusSummary: (connections = []) => {
    const summary = {
      connected: 0,
      error: 0,
      unknown: 0,
      total: connections.length,
      allDisabled:
        connections.length > 0 && connections.every((c) => c?.isActive === false),
    };

    for (const connection of connections) {
      const hasCanonical =
        connection?.routingStatus !== undefined ||
        connection?.authState !== undefined ||
        connection?.healthStatus !== undefined ||
        connection?.quotaState !== undefined ||
        connection?.isActive === false;

      let status = "unknown";
      if (hasCanonical) {
        if (connection?.isActive === false) status = "disabled";
        else if (["expired", "invalid", "revoked"].includes(connection?.authState)) status = "blocked";
        else if (["error", "failed", "unhealthy", "down"].includes(connection?.healthStatus)) status = "blocked";
        else if (["exhausted", "cooldown", "blocked"].includes(connection?.quotaState)) status = "exhausted";
        else if (["eligible", "exhausted", "blocked", "unknown", "disabled"].includes(connection?.routingStatus)) status = connection.routingStatus;
        else if (connection?.quotaState === "ok") status = "eligible";
      }

      if (status === "eligible") summary.connected += 1;
      else if (status === "blocked" || status === "exhausted") summary.error += 1;
      else summary.unknown += 1;
    }

    return summary;
  },
}));

beforeEach(() => {
  providerConnections.length = 0;
  providerNodes.length = 0;
  getProviderConnections.mockClear();
  getProviderNodes.mockClear();
  getProviderConnections.mockResolvedValue(providerConnections);
  getProviderNodes.mockResolvedValue(providerNodes);
});

describe("providers page status display", () => {
  it("treats legacy testStatus-only rows as unknown on dashboard surfaces", () => {
    expect(getDashboardConnectionStatus({ testStatus: "active" })).toBe("unknown");
    expect(getDashboardConnectionStatus({ testStatus: "unavailable" })).toBe("unknown");
  });

  it("keeps canonical status when canonical fields are present", () => {
    expect(getDashboardConnectionStatus({ routingStatus: "eligible" })).toBe("eligible");
    expect(getDashboardConnectionStatus({ authState: "expired" })).toBe("blocked");
    expect(getDashboardConnectionStatus({ quotaState: "cooldown" })).toBe("exhausted");
  });

  it("does not count legacy unavailable records as provider errors", () => {
    const providerConnections = [
      { testStatus: "unavailable", lastErrorAt: "2026-04-22T00:00:00.000Z" },
      { routingStatus: "eligible" },
    ];

    const connected = providerConnections.filter((c) => getDashboardConnectionStatus(c) === "eligible").length;
    const error = providerConnections.filter((c) => {
      const status = getDashboardConnectionStatus(c);
      return status === "blocked" || status === "exhausted";
    }).length;

    expect(connected).toBe(1);
    expect(error).toBe(0);
    expect(getStatusDisplayItems(connected, error, providerConnections.length, null)).toEqual([
      { key: "connected", variant: "success", dot: true, label: "1 Connected" },
    ]);
  });

  it("shows connected and error badges with canonical error tag", () => {
    const display = getStatusDisplayItems(2, 1, 3, "AUTH");
    expect(display).toEqual([
      { key: "connected", variant: "success", dot: true, label: "2 Connected" },
      { key: "error", variant: "error", dot: true, label: "1 Error (AUTH)" },
    ]);
  });

  it("shows saved badge when provider has saved connections but no eligible or error accounts", () => {
    const display = getStatusDisplayItems(0, 0, 3, null);
    expect(display).toEqual([
      { key: "saved", variant: "default", dot: false, label: "3 Saved" },
    ]);
  });

  it("api provider summaries treat legacy-only statuses as unknown", async () => {
    providerConnections.push(
      { id: "c1", provider: "codex", authType: "oauth", testStatus: "unavailable", isActive: true },
      { id: "c2", provider: "codex", authType: "oauth", routingStatus: "eligible", isActive: true },
      { id: "c3", provider: "codex", authType: "oauth", authState: "expired", isActive: true },
    );

    const { GET } = await import("../../src/app/api/providers/route.js");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body.providerSummaries).toMatchObject({
      codex: {
        oauth: {
          connected: 1,
          error: 1,
          unknown: 1,
          total: 3,
        },
      },
    });
  });
});
