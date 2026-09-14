import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { STAGGER_PROVIDERS } from "@/shared/services/quotaStagger.js";
import { mergeWithDefaults } from "@/lib/db/repos/settingsRepo.js";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({
    status: init?.status || 200,
    headers: init?.headers,
    body,
    async json() {
      return body;
    },
  })),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getProviderConnections: vi.fn(),
  configureQuotaAutoPing: vi.fn(),
  applyOutboundProxyEnv: vi.fn(),
  resetComboRotation: vi.fn(),
  bcryptCompare: vi.fn(),
  bcryptHash: vi.fn(),
  bcryptGenSalt: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: mocks.json },
}));

vi.mock("bcryptjs", () => ({
  default: {
    compare: mocks.bcryptCompare,
    hash: mocks.bcryptHash,
    genSalt: mocks.bcryptGenSalt,
  },
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
  getProviderConnections: mocks.getProviderConnections,
}));

vi.mock("@/lib/network/outboundProxy", () => ({
  applyOutboundProxyEnv: mocks.applyOutboundProxyEnv,
}));

vi.mock("open-sse/services/combo.js", () => ({
  resetComboRotation: mocks.resetComboRotation,
}));

vi.mock("@/shared/services/quotaAutoPing", () => ({
  configureQuotaAutoPing: mocks.configureQuotaAutoPing,
}));

const { GET, PATCH } = await import("@/app/api/settings/route.js");

let staggerGroupsModule;
let toggleComponent;

beforeAll(async () => {
  const { transformWithOxc } = await import("vite");
  const fs = await import("node:fs");
  const path = await import("node:path");

  const srcPath = path.resolve(
    __dirname,
    "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/StaggerGroups.js"
  );
  const src = fs.readFileSync(srcPath, "utf8");
  const transformed = await transformWithOxc(src, "StaggerGroups.jsx", {
    jsx: { runtime: "automatic" },
  });

  let code = transformed.code;
  code = code.replace(/import ProviderIcon from [^;]+;/, "const ProviderIcon = () => null;");
  code = code.replace(
    /import Toggle from [^;]+;/,
    "const Toggle = ({ checked, onChange, label }) => null;"
  );
  code = code.replace(/import Card from [^;]+;/, "const Card = ({ children }) => children;");
  code = code.replace(
    /import \* as quotaStagger from [^;]+;/,
    'const quotaStagger = await import("../src/shared/services/quotaStagger.js");'
  );

  const tmpPath = path.resolve(__dirname, "../../node_modules/.tmp-stagger-groups-test.mjs");
  fs.writeFileSync(tmpPath, code);
  try {
    staggerGroupsModule = await import(tmpPath);
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch {}
  }

  const togglePath = path.resolve(__dirname, "../../src/shared/components/Toggle.js");
  const toggleSrc = fs.readFileSync(togglePath, "utf8");
  const transformedToggle = await transformWithOxc(toggleSrc, "Toggle.jsx", {
    jsx: { runtime: "automatic" },
  });
  let toggleCode = transformedToggle.code;
  toggleCode = toggleCode.replace(
    /import \{ cn \} from [^;]+;/,
    'const cn = (...args) => args.filter(Boolean).join(" ");'
  );

  const tmpToggle = path.resolve(__dirname, "../../node_modules/.tmp-toggle-test.mjs");
  fs.writeFileSync(tmpToggle, toggleCode);
  try {
    const mod = await import(tmpToggle);
    toggleComponent = mod.default;
  } finally {
    try {
      fs.unlinkSync(tmpToggle);
    } catch {}
  }
});

describe("settings API - quota stagger groups", () => {
  const sampleConnections = [
    { id: "codex-1", provider: "codex", authType: "oauth", isActive: true, apiKey: "secret-1" },
    { id: "codex-2", provider: "codex", authType: "oauth", isActive: true, apiKey: "secret-2" },
    { id: "claude-1", provider: "claude", authType: "oauth", isActive: true, apiKey: "secret-3" },
    { id: "ag-1", provider: "antigravity", authType: "oauth", isActive: true, apiKey: "secret-4" },
    { id: "inactive-codex", provider: "codex", authType: "oauth", isActive: false },
    { id: "apikey-conn", provider: "codex", authType: "api_key", isActive: true },
    { id: "unsupported-conn", provider: "unknown_provider", authType: "oauth", isActive: true },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnections.mockResolvedValue(sampleConnections);
    mocks.getSettings.mockResolvedValue({
      requireLogin: true,
      quotaStaggerGroups: [],
    });
    mocks.updateSettings.mockImplementation(async (updates) => ({
      requireLogin: true,
      quotaStaggerGroups: [],
      ...updates,
    }));
  });

  it("GET returns safe settings with quotaStaggerGroups and strips credentials", async () => {
    mocks.getSettings.mockResolvedValue({
      password: "hashed_password",
      oidcClientSecret: "super_secret",
      quotaStaggerGroups: [
        {
          id: "g1",
          name: "Group 1",
          enabled: false,
          connectionIds: ["codex-1", "codex-2"],
          session: { enabled: true, anchorAt: null },
          weekly: { enabled: false, anchorAt: null },
          protectWindowStart: true,
        },
      ],
    });

    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.body.password).toBeUndefined();
    expect(res.body.oidcClientSecret).toBeUndefined();
    expect(res.body.quotaStaggerGroups).toHaveLength(1);
    expect(res.body.quotaStaggerGroups[0].id).toBe("g1");
    expect(res.body.quotaStaggerGroups[0].connectionIds).toEqual(["codex-1", "codex-2"]);
    expect(JSON.stringify(res.body)).not.toContain("secret");
  });

  it("PATCH validates and saves valid quotaStaggerGroups and triggers configureQuotaAutoPing", async () => {
    const validGroup = {
      id: "group-1",
      name: "Stagger Group 1",
      enabled: true,
      protectWindowStart: true,
      connectionIds: ["codex-1", "codex-2"],
      session: { enabled: true },
      weekly: { enabled: false },
    };

    const request = new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quotaStaggerGroups: [validGroup] }),
    });

    const res = await PATCH(request);
    expect(res.status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalled();

    const savedArgs = mocks.updateSettings.mock.calls[0][0];
    expect(savedArgs.quotaStaggerGroups).toHaveLength(1);
    expect(savedArgs.quotaStaggerGroups[0].id).toBe("group-1");
    expect(savedArgs.quotaStaggerGroups[0].enabled).toBe(true);
    expect(savedArgs.quotaStaggerGroups[0].protectWindowStart).toBe(true);
    expect(savedArgs.quotaStaggerGroups[0].session.enabled).toBe(true);
    expect(savedArgs.quotaStaggerGroups[0].session.anchorAt).toBeTruthy();

    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.configureQuotaAutoPing).toHaveBeenCalled();
  });

  it("PATCH rejects non-array quotaStaggerGroups with 400", async () => {
    const request = new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quotaStaggerGroups: "invalid" }),
    });

    const res = await PATCH(request);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("must be an array");
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("PATCH rejects enabled group with fewer than 2 connections with 400", async () => {
    const invalidGroup = {
      id: "group-solo",
      name: "Solo",
      enabled: true,
      connectionIds: ["codex-1"],
      session: { enabled: true },
      weekly: { enabled: false },
    };

    const request = new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quotaStaggerGroups: [invalidGroup] }),
    });

    const res = await PATCH(request);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("at least 2 distinct active OAuth");
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("PATCH rejects enabled group with unknown connection with 400", async () => {
    const invalidGroup = {
      id: "group-1",
      name: "Unknown Conn",
      enabled: true,
      connectionIds: ["codex-1", "non-existent-id"],
      session: { enabled: true },
      weekly: { enabled: false },
    };

    const request = new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quotaStaggerGroups: [invalidGroup] }),
    });

    const res = await PATCH(request);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Connection not found");
  });

  it("PATCH rejects enabled group with inactive connection with 400", async () => {
    const invalidGroup = {
      id: "group-1",
      name: "Inactive Conn",
      enabled: true,
      connectionIds: ["codex-1", "inactive-codex"],
      session: { enabled: true },
      weekly: { enabled: false },
    };

    const request = new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quotaStaggerGroups: [invalidGroup] }),
    });

    const res = await PATCH(request);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Connection is not active");
  });

  it("PATCH rejects enabled group with API key connection with 400", async () => {
    const invalidGroup = {
      id: "group-1",
      name: "API Key Conn",
      enabled: true,
      connectionIds: ["codex-1", "apikey-conn"],
      session: { enabled: true },
      weekly: { enabled: false },
    };

    const request = new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quotaStaggerGroups: [invalidGroup] }),
    });

    const res = await PATCH(request);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Connection is not OAuth");
  });

  it("PATCH rejects enabled group with unsupported provider with 400", async () => {
    const invalidGroup = {
      id: "group-1",
      name: "Unsupported Conn",
      enabled: true,
      connectionIds: ["codex-1", "unsupported-conn"],
      session: { enabled: true },
      weekly: { enabled: false },
    };

    const request = new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quotaStaggerGroups: [invalidGroup] }),
    });

    const res = await PATCH(request);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Unsupported provider");
  });

  it("PATCH allows disabled group with insufficient or stale members", async () => {
    const disabledGroup = {
      id: "group-disabled-stale",
      name: "Disabled Stale Group",
      enabled: false,
      connectionIds: ["codex-1", "stale-non-existent"],
      session: { enabled: true },
      weekly: { enabled: false },
    };

    const request = new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quotaStaggerGroups: [disabledGroup] }),
    });

    const res = await PATCH(request);
    expect(res.status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalled();
  });

  it("PATCH rejects enabled group with no policy enabled with 400", async () => {
    const invalidGroup = {
      id: "group-1",
      name: "No Policies",
      enabled: true,
      connectionIds: ["codex-1", "codex-2"],
      session: { enabled: false },
      weekly: { enabled: false },
    };

    const request = new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quotaStaggerGroups: [invalidGroup] }),
    });

    const res = await PATCH(request);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("at least one policy");
  });

  it("PATCH rejects member overlapping across multiple enabled groups with 400", async () => {
    const overlapping = [
      {
        id: "group-1",
        name: "Group 1",
        enabled: true,
        connectionIds: ["codex-1", "codex-2"],
        session: { enabled: true },
        weekly: { enabled: false },
      },
      {
        id: "group-2",
        name: "Group 2",
        enabled: true,
        connectionIds: ["codex-2", "claude-1"],
        session: { enabled: true },
        weekly: { enabled: false },
      },
    ];

    const request = new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quotaStaggerGroups: overlapping }),
    });

    const res = await PATCH(request);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("belongs to multiple enabled groups");
  });

  it("PATCH preserves existing quotaStaggerGroups on unrelated settings patch", async () => {
    const existingGroup = {
      id: "existing-g1",
      name: "Existing Group",
      enabled: false,
      connectionIds: ["codex-1", "codex-2"],
      session: { enabled: true, anchorAt: null },
      weekly: { enabled: false, anchorAt: null },
      protectWindowStart: true,
    };
    mocks.getSettings.mockResolvedValue({
      quotaStaggerGroups: [existingGroup],
      cavemanEnabled: false,
    });
    mocks.updateSettings.mockImplementation(async (updates) => ({
      quotaStaggerGroups: [existingGroup],
      ...updates,
    }));

    const request = new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cavemanEnabled: true }),
    });

    const res = await PATCH(request);
    expect(res.status).toBe(200);

    const savedArgs = mocks.updateSettings.mock.calls[0][0];
    expect(savedArgs.quotaStaggerGroups).toBeUndefined();
    expect(savedArgs.cavemanEnabled).toBe(true);
    expect(res.body.quotaStaggerGroups).toHaveLength(1);
    expect(res.body.quotaStaggerGroups[0].id).toBe("existing-g1");
  });

  it("PATCH preserves existing anchorAt on normal group edit", async () => {
    const initialAnchor = "2026-09-01T00:00:00.000Z";
    const existingGroup = {
      id: "g1",
      name: "Old Name",
      enabled: true,
      connectionIds: ["codex-1", "codex-2"],
      session: { enabled: true, anchorAt: initialAnchor },
      weekly: { enabled: false, anchorAt: null },
      protectWindowStart: false,
    };
    mocks.getSettings.mockResolvedValue({
      quotaStaggerGroups: [existingGroup],
    });

    const editedGroup = {
      id: "g1",
      name: "New Name",
      enabled: true,
      protectWindowStart: true,
      connectionIds: ["codex-2", "codex-1"],
      session: { enabled: true },
      weekly: { enabled: false },
    };

    const request = new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quotaStaggerGroups: [editedGroup] }),
    });

    const res = await PATCH(request);
    expect(res.status).toBe(200);

    const savedArgs = mocks.updateSettings.mock.calls[0][0];
    expect(savedArgs.quotaStaggerGroups[0].session.anchorAt).toBe(initialAnchor);
    expect(savedArgs.quotaStaggerGroups[0].protectWindowStart).toBe(true);
  });
});

describe("UI helper functions and component exports from StaggerGroups", () => {
  const connections = [
    { id: "c1", provider: "codex", authType: "oauth", isActive: true },
    { id: "c2", provider: "claude", authType: "oauth", isActive: true },
    { id: "c3", provider: "antigravity", authType: "oauth", isActive: true },
    { id: "c4", provider: "codex", authType: "oauth", isActive: false },
    { id: "c5", provider: "codex", authType: "api_key", isActive: true },
    { id: "c6", provider: "unknown", authType: "oauth", isActive: true },
  ];

  it("getSupportedOAuthConnections returns only active OAuth connections for supported providers", () => {
    const supported = staggerGroupsModule.getSupportedOAuthConnections(connections);
    expect(supported.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("isStaggerGroupsVisible returns true when >= 2 active OAuth supported providers exist", () => {
    expect(staggerGroupsModule.isStaggerGroupsVisible(connections, [])).toBe(true);
  });

  it("isStaggerGroupsVisible returns true when < 2 active connections exist but existing groups exist", () => {
    const singleConn = [{ id: "c1", provider: "codex", authType: "oauth", isActive: true }];
    const existingGroups = [{ id: "g1", name: "Group 1", connectionIds: ["c1", "deleted"] }];
    expect(staggerGroupsModule.isStaggerGroupsVisible(singleConn, existingGroups)).toBe(true);
  });

  it("isStaggerGroupsVisible returns false when < 2 active connections and no existing groups", () => {
    const singleConn = [{ id: "c1", provider: "codex", authType: "oauth", isActive: true }];
    expect(staggerGroupsModule.isStaggerGroupsVisible(singleConn, [])).toBe(false);
    expect(staggerGroupsModule.isStaggerGroupsVisible([], [])).toBe(false);
  });

  it("resolvePolicyMemberIds and getMemberPhaseOffset exclude unsupported Antigravity without 1/3 offset", () => {
    const mixedGroup = {
      id: "mixed",
      connectionIds: ["c1", "c2", "c3"],
    };

    const sessionMembers = staggerGroupsModule.resolvePolicyMemberIds(
      mixedGroup,
      connections,
      "session"
    );
    expect(sessionMembers).toEqual(["c1", "c2"]);

    const offset1 = staggerGroupsModule.getMemberPhaseOffset("c1", sessionMembers);
    expect(offset1).toEqual({ slot: 1, total: 2, pct: 0 });

    const offset2 = staggerGroupsModule.getMemberPhaseOffset("c2", sessionMembers);
    expect(offset2).toEqual({ slot: 2, total: 2, pct: 50 });

    const offset3 = staggerGroupsModule.getMemberPhaseOffset("c3", sessionMembers);
    expect(offset3).toBeNull();
  });

  it("createDefaultGroup uses crypto.randomUUID and default off with protectWindowStart true", () => {
    const group = staggerGroupsModule.createDefaultGroup([]);
    expect(group.enabled).toBe(false);
    expect(group.protectWindowStart).toBe(true);
    expect(group.connectionIds).toEqual([]);
    expect(group.session.enabled).toBe(true);
    expect(group.weekly.enabled).toBe(false);
    expect(group.name).toBe("Stagger Group 1");
    expect(typeof group.id).toBe("string");
    expect(group.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it("reorderConnectionIds swaps positions and handles out-of-bounds cleanly", () => {
    const initial = ["a", "b", "c"];
    const reordered = staggerGroupsModule.reorderConnectionIds(initial, 0, 1);
    expect(reordered).toEqual(["b", "a", "c"]);

    const reorderedLater = staggerGroupsModule.reorderConnectionIds(reordered, 1, 2);
    expect(reorderedLater).toEqual(["b", "c", "a"]);

    expect(staggerGroupsModule.reorderConnectionIds(initial, -1, 1)).toEqual(["a", "b", "c"]);
    expect(staggerGroupsModule.reorderConnectionIds(initial, 0, 10)).toEqual(["a", "b", "c"]);
  });

  it("removeConnectionId filters out target ID without modifying other elements", () => {
    const initial = ["cx-1", "deleted-id", "cx-2"];
    const cleaned = staggerGroupsModule.removeConnectionId(initial, "deleted-id");
    expect(cleaned).toEqual(["cx-1", "cx-2"]);
    expect(staggerGroupsModule.removeConnectionId(cleaned, "non-existent")).toEqual(["cx-1", "cx-2"]);
  });

  it("renders StaggerGroups via React server smoke without prop errors", () => {
    const html = ReactDOMServer.renderToString(
      React.createElement(staggerGroupsModule.default)
    );
    expect(html).toContain("Quota Stagger Groups");
  });

  it("exposes phase-alignment copy without interval-catchup claims", () => {
    const copy = staggerGroupsModule.STAGGER_COPY;
    expect(copy.groupEnabled).toContain("Default OFF");
    expect(copy.groupEnabled).toContain("explicit member order");
    expect(copy.groupEnabled).toContain("Antigravity");
    expect(copy.phaseOrder).toContain("First eligible member is the reference");
    expect(copy.session).toContain("actual upstream session windows");
    expect(copy.session).toContain("forecasts the next activation");
    expect(copy.session).toContain("finish normally");
    expect(copy.session).toContain("realign when they expire");
    expect(copy.weekly).toContain("separately");
    expect(copy.bothEnabled).toContain("without interruption");
    expect(copy.bothEnabled).toContain("longer deadline controls");
    expect(copy.bothEnabled).toContain("full weekly cycle");
    expect(copy.bothEnabled).toContain("one activation starts both");
    expect(copy.bothEnabled).toContain("not independent pings");
    expect(copy.protectWindowStart).toContain("ordinary routed requests are deferred after");
    expect(copy.protectWindowStart).toContain("unknown fixed quotas cannot guarantee phase alignment");
    expect(JSON.stringify(copy)).not.toMatch(/catch.?up|manual pause|immediate/iu);
  });

  it("renders Toggle and verifies prop contract where onChange receives boolean", () => {
    let toggledValue = null;
    const testOnChange = (val) => {
      toggledValue = val;
    };

    const toggleHtml = ReactDOMServer.renderToString(
      React.createElement(toggleComponent, {
        checked: false,
        onChange: testOnChange,
        label: "Session staggering",
        description: "Test description",
        size: "sm",
      })
    );

    expect(toggleHtml).toContain("Session staggering");
    expect(toggleHtml).toContain('aria-checked="false"');

    const activeToggleHtml = ReactDOMServer.renderToString(
      React.createElement(toggleComponent, {
        checked: true,
        onChange: testOnChange,
        label: "Weekly staggering",
        size: "sm",
      })
    );

    expect(activeToggleHtml).toContain('aria-checked="true"');

    testOnChange(!false);
    expect(toggledValue).toBe(true);
    testOnChange(!true);
    expect(toggledValue).toBe(false);
  });

  it("loadStaggerConnections fetches multiple pages and deduplicates IDs", async () => {
    const page1Conns = Array.from({ length: 500 }, (_, i) => ({ id: `conn-${i}`, provider: "codex" }));
    const page2Conns = Array.from({ length: 200 }, (_, i) => ({ id: `conn-${i + 400}`, provider: "claude" }));

    const mockFetch = vi.fn(async (url) => {
      if (url.includes("page=1")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            connections: page1Conns,
            pagination: { page: 1, pageSize: 500, total: 600, totalPages: 2 },
          }),
        };
      }
      if (url.includes("page=2")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            connections: page2Conns,
            pagination: { page: 2, pageSize: 500, total: 600, totalPages: 2 },
          }),
        };
      }
      return { ok: false, status: 404 };
    });

    const result = await staggerGroupsModule.loadStaggerConnections(mockFetch);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.length).toBe(600);
    expect(result.find((c) => c.id === "conn-0")).toBeDefined();
    expect(result.find((c) => c.id === "conn-599")).toBeDefined();
  });

  it("loadStaggerConnections throws when a later page fails, preventing incomplete state", async () => {
    const mockFetch = vi.fn(async (url) => {
      if (url.includes("page=1")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            connections: [{ id: "c1" }],
            pagination: { page: 1, pageSize: 500, total: 1000, totalPages: 2 },
          }),
        };
      }
      return {
        ok: false,
        status: 500,
      };
    });

    await expect(staggerGroupsModule.loadStaggerConnections(mockFetch)).rejects.toThrow("page 2");
  });

  it("loadStaggerConnections throws when the first page fails", async () => {
    const mockFetch = vi.fn(async () => ({
      ok: false,
      status: 503,
    }));

    await expect(staggerGroupsModule.loadStaggerConnections(mockFetch)).rejects.toThrow("page 1");
  });
});

describe("settingsRepo - mergeWithDefaults", () => {
  it("defaults quotaStaggerGroups to empty array when raw settings omit it", () => {
    const merged = mergeWithDefaults({});
    expect(merged.quotaStaggerGroups).toEqual([]);
  });

  it("preserves existing quotaStaggerGroups when present in raw settings", () => {
    const existing = [
      {
        id: "g-preset",
        name: "Preset Group",
        enabled: true,
        connectionIds: ["cx-1", "cx-2"],
        session: { enabled: true, anchorAt: "2026-09-01T00:00:00.000Z" },
        weekly: { enabled: false, anchorAt: null },
        protectWindowStart: true,
      },
    ];
    const merged = mergeWithDefaults({ quotaStaggerGroups: existing });
    expect(merged.quotaStaggerGroups).toBe(existing);
  });
});
