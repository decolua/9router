import { afterEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  getCapsOverrides: vi.fn(async () => ({})),
  setCapsOverride: vi.fn(async () => {}),
  deleteCapsOverride: vi.fn(async () => {})
}));
vi.mock("@/lib/db/index.js", () => db);
import { PUT, DELETE } from "../../src/app/api/models/caps/route.js";
afterEach(() => vi.clearAllMocks());
const request = body => ({
  json: async () => body
});
describe("capability override input boundary", () => {
  it.each([{
    provider: [],
    model: "m",
    caps: {}
  }, {
    provider: "p|other",
    model: "m",
    caps: {}
  }, {
    provider: "p",
    model: {},
    caps: {}
  }, {
    provider: "p",
    model: "m",
    caps: {
      vision: "yes"
    }
  }, {
    provider: "p",
    model: "m",
    caps: {
      contextWindow: 0
    }
  }, {
    provider: "p",
    model: "m",
    caps: {
      thinkingRange: {
        min: 5,
        max: 1
      }
    }
  }, {
    provider: "p",
    model: "m",
    caps: {
      unknown: true
    }
  }])("rejects invalid input without writing", async body => {
    expect((await PUT(request(body))).status).toBe(400);
    expect(db.setCapsOverride).not.toHaveBeenCalled();
    expect(db.deleteCapsOverride).not.toHaveBeenCalled();
  });
  it("stores explicit false and positive token limits", async () => {
    const caps = {
      vision: false,
      contextWindow: 64000
    };
    expect((await PUT(request({
      provider: "node",
      model: "vendor/model",
      caps
    }))).status).toBe(200);
    expect(db.setCapsOverride).toHaveBeenCalledWith("node", "vendor/model", caps);
  });
  it("resets an override through an empty object", async () => {
    expect((await PUT(request({
      provider: "node",
      model: "m",
      caps: {}
    }))).status).toBe(200);
    expect(db.deleteCapsOverride).toHaveBeenCalledWith("node", "m");
  });
  it("validates reset query identities", async () => {
    const response = await DELETE(new Request("https://router.fixture/api/models/caps?provider=a%7Cb&model=m"));
    expect(response.status).toBe(400);
    expect(db.deleteCapsOverride).not.toHaveBeenCalled();
  });
});
