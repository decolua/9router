import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getConfiguredBaseUrl,
  isLoopbackHostname,
  isLoopbackUrl,
  isHosted,
  getPublicOrigin,
} from "../../src/shared/utils/deploymentMode.js";

describe("deploymentMode", () => {
  const envKeys = ["DEPLOYMENT_MODE", "BASE_URL", "NEXT_PUBLIC_BASE_URL"];
  let saved = {};

  beforeEach(() => {
    saved = {};
    for (const key of envKeys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("treats empty config as local", () => {
    expect(isHosted()).toBe(false);
    expect(getConfiguredBaseUrl()).toBe("");
    expect(getPublicOrigin()).toBe("http://localhost:20128");
  });

  it("forces hosted via DEPLOYMENT_MODE", () => {
    process.env.DEPLOYMENT_MODE = "hosted";
    expect(isHosted()).toBe(true);
  });

  it("forces local via DEPLOYMENT_MODE even with public BASE_URL", () => {
    process.env.DEPLOYMENT_MODE = "local";
    process.env.BASE_URL = "https://example.com";
    expect(isHosted()).toBe(false);
  });

  it("infers hosted from non-loopback BASE_URL", () => {
    process.env.BASE_URL = "https://router.example.com";
    expect(isHosted()).toBe(true);
    expect(getPublicOrigin()).toBe("https://router.example.com");
  });

  it("keeps localhost BASE_URL as local", () => {
    process.env.BASE_URL = "http://localhost:20128";
    expect(isHosted()).toBe(false);
    expect(isLoopbackUrl(process.env.BASE_URL)).toBe(true);
  });

  it("detects loopback hostnames", () => {
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("::1")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
    expect(isLoopbackHostname("example.com")).toBe(false);
  });
});
