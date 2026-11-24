import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveClineModels, resolveClinepassModels } from "../../open-sse/services/clinepassModels.js";
afterEach(() => vi.unstubAllGlobals());
describe("Cline catalog boundaries", () => {
  it("isolates subscription IDs while retaining the additive free tier", async () => {
    vi.stubGlobal("fetch", vi.fn(async url => Response.json(String(url).includes("recommended-models") ? {
      free: [{
        id: "cline-free/free-model"
      }]
    } : {
      data: [{
        id: "vendor/regular"
      }, {
        id: "cline-pass/paid-model"
      }]
    })));
    expect((await resolveClineModels({
      apiKey: "fixture"
    })).models.map(m => m.id)).toEqual(["vendor/regular", "cline-free/free-model"]);
    expect((await resolveClinepassModels({
      apiKey: "fixture"
    })).models.map(m => m.id)).toEqual(["cline-pass/paid-model"]);
  });
  it("keeps the regular catalog when the recommended feed fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async url => String(url).includes("recommended-models") ? new Response(null, {
      status: 503
    }) : Response.json({
      data: [{
        id: "vendor/regular"
      }, {
        id: "cline-pass/paid-model"
      }]
    })));
    expect((await resolveClineModels({
      apiKey: "fixture"
    })).models.map(m => m.id)).toEqual(["vendor/regular"]);
  });
});
