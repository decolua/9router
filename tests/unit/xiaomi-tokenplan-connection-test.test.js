import { describe, expect, it } from "vitest";
import {
  isXiaomiTokenplanTestResponseValid,
  resolveXiaomiTokenplanModelsUrl,
} from "../../open-sse/config/providers.js";

const REGION_URLS = {
  sgp: "https://token-plan-sgp.xiaomimimo.com/v1/models",
  cn: "https://token-plan-cn.xiaomimimo.com/v1/models",
  ams: "https://token-plan-ams.xiaomimimo.com/v1/models",
};

function connection(region) {
  return {
    providerSpecificData: region ? { region } : {},
  };
}

describe("Xiaomi Token Plan connection test", () => {
  it.each(Object.entries(REGION_URLS))("tests the %s cluster selected by the connection", (region, expectedUrl) => {
    expect(resolveXiaomiTokenplanModelsUrl(connection(region))).toBe(expectedUrl);
  });

  it.each([undefined, "unknown"])("falls back to the default cluster for region %s", (region) => {
    expect(resolveXiaomiTokenplanModelsUrl(connection(region))).toBe(REGION_URLS.sgp);
  });

  it("accepts a non-401 response because valid keys may not list models", () => {
    expect(isXiaomiTokenplanTestResponseValid({ ok: false, status: 403 })).toBe(true);
  });

  it("rejects a 401 response", () => {
    expect(isXiaomiTokenplanTestResponseValid({ ok: false, status: 401 })).toBe(false);
  });
});
