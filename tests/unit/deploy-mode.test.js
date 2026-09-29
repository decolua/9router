import { describe, it, expect, afterEach, vi } from "vitest";

const ENV_KEYS = ["CONTAINER_DEPLOY", "RENDER", "FLY_APP_NAME", "K_SERVICE", "BASE_URL"];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

async function load() {
  vi.resetModules();
  const m = await import("@/lib/deployMode.js");
  return { isHosted: m.isHosted, isContainerDeploy: m.isContainerDeploy };
}

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.doUnmock("fs");
});

describe("Deploy Environment (isHosted / isContainerDeploy)", () => {
  it("detects Render", async () => {
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.RENDER = "true";
    const { isHosted } = await load();
    expect(isHosted()).toBe(true);
  });

  it("detects the CONTAINER_DEPLOY override", async () => {
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.CONTAINER_DEPLOY = "1";
    const { isHosted } = await load();
    expect(isHosted()).toBe(true);
  });

  it("detects Sevalla via BASE_URL *.sevalla.app", async () => {
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.BASE_URL = "https://router-uz2an.sevalla.app";
    vi.doMock("fs", () => ({ default: { existsSync: () => false } }));
    const { isHosted } = await load();
    expect(isHosted()).toBe(true);
  });

  it("does not treat a local BASE_URL as hosted", async () => {
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.BASE_URL = "http://localhost:3000";
    vi.doMock("fs", () => ({ default: { existsSync: () => false } }));
    const { isHosted } = await load();
    expect(isHosted()).toBe(false);
  });

  it("keeps isContainerDeploy as an alias of isHosted", async () => {
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.RENDER = "true";
    const { isHosted, isContainerDeploy } = await load();
    expect(isContainerDeploy()).toBe(isHosted());
  });

  it("is false on a plain host with no /.dockerenv", async () => {
    for (const k of ENV_KEYS) delete process.env[k];
    vi.doMock("fs", () => ({ default: { existsSync: () => false } }));
    const { isHosted } = await load();
    expect(isHosted()).toBe(false);
  });
});
