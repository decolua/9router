import { describe, expect, it, vi } from "vitest";
import { isCommunityScriptsInstall } from "@/lib/managedInstall";
const effects = vi.hoisted(() => ({ killAppProcesses: vi.fn(), spawnUpdaterAndExit: vi.fn() }));
vi.mock("@/lib/appUpdater", () => effects);
import { POST as update } from "@/app/api/version/update/route";
import { POST as shutdown } from "@/app/api/version/shutdown/route";

describe("managed Community Scripts installation", () => {
  it("recognizes the installed layout without treating every systemd service as managed", () => {
    const env = { DATA_DIR: "/opt/9router_data" };
    expect(isCommunityScriptsInstall(env, () => true)).toBe(true);
    expect(isCommunityScriptsInstall(env, p => p === "/usr/bin/update")).toBe(false);
    expect(isCommunityScriptsInstall({ DATA_DIR: "/srv/other" }, () => true)).toBe(false);
  });
  it("refuses both update paths before scheduling exit or changing processes", async () => {
    vi.stubEnv("NINEROUTER_INSTALL_TYPE", "community-scripts");
    vi.useFakeTimers();
    try {
      for (const action of [update, shutdown]) {
        const res = await action();
        expect(res.status).toBe(409);
        expect((await res.json()).code).toBe("managed_install");
      }
      expect(effects.killAppProcesses).not.toHaveBeenCalled();
      expect(effects.spawnUpdaterAndExit).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.unstubAllEnvs(); vi.useRealTimers(); }
  });
});
