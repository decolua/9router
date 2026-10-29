import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// In-memory settings row: null = no row stored yet (fresh config).
const mocks = vi.hoisted(() => ({
  storedData: { value: null },
}));

vi.mock("../../src/lib/db/driver.js", () => ({
  getAdapter: vi.fn(async () => ({
    get: vi.fn(() =>
      mocks.storedData.value === null ? undefined : { data: mocks.storedData.value },
    ),
  })),
}));

const { getSettings } = await import("../../src/lib/db/repos/settingsRepo.js");

const ENV_KEY = "REQUIRE_API_KEY";

describe("settingsRepo REQUIRE_API_KEY env handling (QA-9ROUTER-5)", () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
    mocks.storedData.value = null;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = originalEnv;
    }
  });

  it("defaults requireApiKey=true on a fresh config when env is unset (secure default)", async () => {
    const settings = await getSettings();
    expect(settings.requireApiKey).toBe(true);
  });

  it("REQUIRE_API_KEY=false disables requireApiKey on a fresh config", async () => {
    process.env[ENV_KEY] = "false";

    const settings = await getSettings();
    expect(settings.requireApiKey).toBe(false);
  });

  it("REQUIRE_API_KEY=true keeps requireApiKey enabled on a fresh config", async () => {
    process.env[ENV_KEY] = "true";

    const settings = await getSettings();
    expect(settings.requireApiKey).toBe(true);
  });

  it("preserves stored requireApiKey=false when env is unset", async () => {
    mocks.storedData.value = JSON.stringify({ requireApiKey: false });

    const settings = await getSettings();
    expect(settings.requireApiKey).toBe(false);
  });

  it("preserves stored requireApiKey=true when env is unset", async () => {
    mocks.storedData.value = JSON.stringify({ requireApiKey: true });

    const settings = await getSettings();
    expect(settings.requireApiKey).toBe(true);
  });

  it("REQUIRE_API_KEY=false overrides stored requireApiKey=true", async () => {
    process.env[ENV_KEY] = "false";
    mocks.storedData.value = JSON.stringify({ requireApiKey: true });

    const settings = await getSettings();
    expect(settings.requireApiKey).toBe(false);
  });

  it("REQUIRE_API_KEY=true overrides stored requireApiKey=false", async () => {
    process.env[ENV_KEY] = "true";
    mocks.storedData.value = JSON.stringify({ requireApiKey: false });

    const settings = await getSettings();
    expect(settings.requireApiKey).toBe(true);
  });
});
