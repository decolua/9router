import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSettings, updateSettings } from "@/lib/db/repos/settingsRepo.js";

const database = vi.hoisted(() => ({ data: null }));
vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: async () => ({
    get: () => database.data === null ? undefined : { data: database.data },
    run: (_sql, [data]) => { database.data = data; },
    transaction: (write) => write(),
  }),
}));

beforeEach(() => { database.data = null; });

describe("dashboard update notification preference (#5532)", () => {
  it.each([null, JSON.stringify({ requireLogin: false })])("keeps notifications enabled for existing settings %j", async (data) => {
    database.data = data;
    expect((await getSettings()).showUpdateNotifications).toBe(true);
  });

  it("persists disabling notifications across settings reads", async () => {
    await updateSettings({ showUpdateNotifications: false });
    expect((await getSettings()).showUpdateNotifications).toBe(false);
  });

  it("retains an opt-out when other settings change", async () => {
    await updateSettings({ showUpdateNotifications: false });
    await updateSettings({ enableObservability: true });
    expect(await getSettings()).toMatchObject({ showUpdateNotifications: false, enableObservability: true });
  });

  it("lets notifications be enabled again without losing other preferences", async () => {
    await updateSettings({ showUpdateNotifications: false, requireLogin: false });
    await updateSettings({ showUpdateNotifications: true });
    expect(await getSettings()).toMatchObject({ showUpdateNotifications: true, requireLogin: false });
  });
});
