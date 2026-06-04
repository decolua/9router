import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MODULE = "../../open-sse/utils/antigravityClientIdentity.js";
const ORIGINAL_ANTIGRAVITY_PRODUCT_JSON = process.env.ANTIGRAVITY_PRODUCT_JSON;
const ORIGINAL_ANTIGRAVITY_OAUTH_CLIENT_SECRET = process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET;
const tempDirs = [];

async function loadFresh() {
  vi.resetModules();
  return await import(MODULE);
}

function writeTempProductJson(productJson) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ag-product-"));
  tempDirs.push(dir);
  const productJsonPath = path.join(dir, "product.json");
  fs.writeFileSync(productJsonPath, JSON.stringify(productJson, null, 2));
  return productJsonPath;
}

afterEach(() => {
  if (ORIGINAL_ANTIGRAVITY_PRODUCT_JSON === undefined) {
    delete process.env.ANTIGRAVITY_PRODUCT_JSON;
  } else {
    process.env.ANTIGRAVITY_PRODUCT_JSON = ORIGINAL_ANTIGRAVITY_PRODUCT_JSON;
  }
  if (ORIGINAL_ANTIGRAVITY_OAUTH_CLIENT_SECRET === undefined) {
    delete process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET;
  } else {
    process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET = ORIGINAL_ANTIGRAVITY_OAUTH_CLIENT_SECRET;
  }
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("antigravityClientIdentity", () => {
  it("reads top-level ideVersion from the installed product.json", async () => {
    const productJson = writeTempProductJson({
      ideVersion: "9.8.7",
      version: "1.107.0",
      nameLong: "Antigravity",
      applicationName: "antigravity",
    });
    process.env.ANTIGRAVITY_PRODUCT_JSON = productJson;

    const mod = await loadFresh();

    expect(mod.getAntigravityIdeVersion()).toBe("9.8.7");
    expect(mod.getAntigravityUserAgent()).toMatch(/^antigravity\/9\.8\.7 /);
  });

  it("falls back to the known-good Antigravity ideVersion when product.json is missing", async () => {
    process.env.ANTIGRAVITY_PRODUCT_JSON = "/path/does/not/exist/product.json";

    const mod = await loadFresh();

    expect(mod.getAntigravityIdeVersion()).toBe("1.23.2");
    expect(mod.getAntigravityUserAgent()).toMatch(/^antigravity\/1\.23\.2 /);
  });

  it("ignores VS Code base version when ideVersion exists", async () => {
    const productJson = writeTempProductJson({
      ideVersion: "1.23.2",
      version: "1.107.0",
    });
    process.env.ANTIGRAVITY_PRODUCT_JSON = productJson;

    const mod = await loadFresh();

    expect(mod.getAntigravityIdeVersion()).toBe("1.23.2");
    expect(mod.getAntigravityUserAgent()).not.toContain("1.107.0");
  });
});

describe("Antigravity exported constants", () => {
  it("uses the shared identity for app constants and provider config", async () => {
    const productJson = writeTempProductJson({ ideVersion: "7.7.7", version: "1.107.0" });
    process.env.ANTIGRAVITY_PRODUCT_JSON = productJson;
    vi.resetModules();

    const appConstants = await import("../../open-sse/config/appConstants.js");
    const providers = await import("../../open-sse/config/providers.js");

    expect(appConstants.getPlatformUserAgent()).toMatch(/^antigravity\/7\.7\.7 /);
    expect(appConstants.ANTIGRAVITY_HEADERS["User-Agent"]).toMatch(/^antigravity\/7\.7\.7 /);
    expect(providers.PROVIDERS.antigravity.headers["User-Agent"]).toMatch(/^antigravity\/7\.7\.7 /);
  });

  it("reads the Antigravity OAuth client secret from the environment", async () => {
    process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET = "test-secret";
    vi.resetModules();

    const providers = await import("../../open-sse/config/providers.js");
    const usage = await import("../../open-sse/services/usage.js");

    expect(providers.PROVIDERS.antigravity.clientSecret).toBe("test-secret");
    expect(usage.__TESTING__.ANTIGRAVITY_CONFIG.clientSecret).toBe("test-secret");
  });

  it("does not fall back to a committed Antigravity OAuth client secret", async () => {
    delete process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET;
    vi.resetModules();

    const providers = await import("../../open-sse/config/providers.js");
    const usage = await import("../../open-sse/services/usage.js");

    expect(providers.PROVIDERS.antigravity.clientSecret).toBe("");
    expect(usage.__TESTING__.ANTIGRAVITY_CONFIG.clientSecret).toBe("");
  });
});
