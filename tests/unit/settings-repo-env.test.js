import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    get: vi.fn(),
  },
}));

vi.mock("../../src/lib/db/driver.js", () => ({
  getAdapter: async () => mocks.db,
}));

const { getSettings } = await import("../../src/lib/db/repos/settingsRepo.js");

const ORIGINAL_ENV = process.env.REQUIRE_API_KEY;

describe("settingsRepo REQUIRE_API_KEY env bridging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.REQUIRE_API_KEY = undefined;
  });

  afterEach(() => {
    process.env.REQUIRE_API_KEY = ORIGINAL_ENV;
  });

  it("defaults requireApiKey to false when env is unset", async () => {
    mocks.db.get.mockReturnValue(undefined);
    const settings = await getSettings();
    expect(settings.requireApiKey).toBe(false);
  });

  it("enables requireApiKey when REQUIRE_API_KEY=true and no stored value", async () => {
    mocks.db.get.mockReturnValue(undefined);
    process.env.REQUIRE_API_KEY = "true";
    const settings = await getSettings();
    expect(settings.requireApiKey).toBe(true);
  });

  it("accepts case-insensitive true variants", async () => {
    mocks.db.get.mockReturnValue(undefined);
    process.env.REQUIRE_API_KEY = "TRUE";
    expect((await getSettings()).requireApiKey).toBe(true);
  });

  it("lets a stored dashboard setting override the env default", async () => {
    mocks.db.get.mockReturnValue({ data: JSON.stringify({ requireApiKey: false }) });
    process.env.REQUIRE_API_KEY = "true";
    const settings = await getSettings();
    expect(settings.requireApiKey).toBe(false);
  });
});
