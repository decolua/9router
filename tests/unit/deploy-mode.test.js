import { describe, it, expect, afterEach, vi } from "vitest";

const ENV_KEYS = ["CONTAINER_DEPLOY", "RENDER", "FLY_APP_NAME", "K_SERVICE"];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

async function load() {
  vi.resetModules();
  return (await import("@/lib/deployMode.js")).isContainerDeploy;
}

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.doUnmock("fs");
});

describe("isContainerDeploy", () => {
  it("detects Render", async () => {
    process.env.RENDER = "true";
    expect((await load())()).toBe(true);
  });

  it("detects the CONTAINER_DEPLOY override", async () => {
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.CONTAINER_DEPLOY = "1";
    expect((await load())()).toBe(true);
  });

  it("is false on a plain host with no /.dockerenv", async () => {
    for (const k of ENV_KEYS) delete process.env[k];
    vi.doMock("fs", () => ({ default: { existsSync: () => false } }));
    expect((await load())()).toBe(false);
  });
});
