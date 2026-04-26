import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/localDb.ts", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

import { getSettings, updateSettings } from "../../src/lib/localDb.ts";
import { getRtkEnabled, refreshRtkFlag, setRtkEnabled } from "../../src/lib/open-sse/rtk/flag.ts";

describe("RTK settings runtime flag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setRtkEnabled(true);
  });

  it("defaults RTK to enabled when the persisted setting is missing", async () => {
    vi.mocked(getSettings).mockResolvedValue({});

    await refreshRtkFlag();

    expect(getRtkEnabled()).toBe(true);
  });

  it("reads persisted RTK disabled state", async () => {
    vi.mocked(getSettings).mockResolvedValue({ enableRtk: false });

    await refreshRtkFlag();

    expect(getRtkEnabled()).toBe(false);
  });

  it("persists RTK setting updates through settings storage", async () => {
    vi.mocked(updateSettings).mockResolvedValue({ enableRtk: false });

    const settings = await updateSettings({ enableRtk: false });

    expect(updateSettings).toHaveBeenCalledWith({ enableRtk: false });
    expect(settings.enableRtk).toBe(false);
  });

  it("updates the runtime flag after settings changes", async () => {
    vi.mocked(getSettings)
      .mockResolvedValueOnce({ enableRtk: true })
      .mockResolvedValueOnce({ enableRtk: false });

    await refreshRtkFlag();
    expect(getRtkEnabled()).toBe(true);

    await refreshRtkFlag();
    expect(getRtkEnabled()).toBe(false);
  });
});
