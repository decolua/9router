import { beforeEach, describe, expect, it, vi } from "vitest";

const getMitmAlias = vi.fn();
const setMitmAliasAll = vi.fn();
const getMitmStatus = vi.fn();
const writeAliasForTool = vi.fn();

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init) => ({ status: init?.status || 200, json: async () => body }),
  },
}));
vi.mock("@/models", () => ({ getMitmAlias, setMitmAliasAll }));
vi.mock("@/mitm/manager", () => ({ getMitmStatus }));
vi.mock("@/lib/mitmAliasCache", () => ({ writeAliasForTool }));

const request = (body) => ({ json: vi.fn(async () => body) });

beforeEach(() => {
  vi.clearAllMocks();
  getMitmStatus.mockResolvedValue({ dnsStatus: { antigravity: true } });
});

describe("Antigravity MITM alias route", () => {
  it("normalizes legacy aliases returned by GET", async () => {
    getMitmAlias.mockResolvedValue({ flash: " p/m ", empty: "" });
    const { GET } = await import("../../src/app/api/cli-tools/antigravity-mitm/alias/route.js");
    const response = await GET(new Request("http://localhost/api?tool=antigravity"));
    expect(await response.json()).toEqual({ aliases: { flash: { model: "p/m" } } });
  });

  it.each([
    ["array payload", []],
    ["primitive entry", { flash: 3 }],
    ["array entry", { flash: ["p/m"] }],
    ["unknown field", { flash: { model: "p/m", extra: true } }],
    ["invalid effort", { flash: { reasoningEffort: "extreme" } }],
  ])("rejects %s before writes", async (_name, mappings) => {
    const { PUT } = await import("../../src/app/api/cli-tools/antigravity-mitm/alias/route.js");
    const response = await PUT(request({ tool: "antigravity", mappings }));
    expect(response.status).toBe(400);
    expect(setMitmAliasAll).not.toHaveBeenCalled();
    expect(writeAliasForTool).not.toHaveBeenCalled();
  });

  it("persists the same canonical mappings to DB and cache", async () => {
    const { PUT } = await import("../../src/app/api/cli-tools/antigravity-mitm/alias/route.js");
    const response = await PUT(request({
      tool: "antigravity",
      mappings: {
        legacy: " p/m ",
        reasoning: { reasoningEffort: " HIGH " },
        combined: { model: " q/m ", reasoningEffort: "Max" },
        cleared: { model: "", reasoningEffort: "" },
      },
    }));
    const expected = {
      legacy: { model: "p/m" },
      reasoning: { reasoningEffort: "high" },
      combined: { model: "q/m", reasoningEffort: "max" },
    };
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, aliases: expected });
    expect(setMitmAliasAll).toHaveBeenCalledWith("antigravity", expected);
    expect(writeAliasForTool).toHaveBeenCalledWith("antigravity", expected);
  });

  it("preserves the DNS authorization boundary", async () => {
    getMitmStatus.mockResolvedValue({ dnsStatus: { antigravity: false } });
    const { PUT } = await import("../../src/app/api/cli-tools/antigravity-mitm/alias/route.js");
    const response = await PUT(request({ tool: "antigravity", mappings: { flash: "p/m" } }));
    expect(response.status).toBe(403);
    expect(setMitmAliasAll).not.toHaveBeenCalled();
    expect(writeAliasForTool).not.toHaveBeenCalled();
  });
});
