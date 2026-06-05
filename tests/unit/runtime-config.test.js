import { describe, expect, it } from "vitest";

async function loadRuntimeConfig(envValue) {
  const previous = process.env.STREAM_STALL_TIMEOUT_MS;
  if (envValue == null) delete process.env.STREAM_STALL_TIMEOUT_MS;
  else process.env.STREAM_STALL_TIMEOUT_MS = envValue;

  const config = await import(
    /* @vite-ignore */ `../../open-sse/config/runtimeConfig.js?case=${Date.now()}-${Math.random()}`
  );

  if (previous == null) delete process.env.STREAM_STALL_TIMEOUT_MS;
  else process.env.STREAM_STALL_TIMEOUT_MS = previous;

  return config;
}

describe("runtime config", () => {
  it("defaults stream stall timeout to 60 seconds", async () => {
    const config = await loadRuntimeConfig(null);

    expect(config.DEFAULT_STREAM_STALL_TIMEOUT_MS).toBe(60000);
    expect(config.STREAM_STALL_TIMEOUT_MS).toBe(60000);
  });

  it("allows stream stall timeout to be configured by env", async () => {
    const config = await loadRuntimeConfig("90000");

    expect(config.STREAM_STALL_TIMEOUT_MS).toBe(90000);
  });

  it("falls back to the default for invalid env values", async () => {
    await expect(loadRuntimeConfig("0")).resolves.toMatchObject({ STREAM_STALL_TIMEOUT_MS: 60000 });
    await expect(loadRuntimeConfig("not-a-number")).resolves.toMatchObject({ STREAM_STALL_TIMEOUT_MS: 60000 });
  });
});
