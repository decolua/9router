import { describe, expect, it, vi } from "vitest";
import {
  evaluateVersionPolicy,
  getVersionStatus,
  registryLatestUrl,
} from "../../src/lib/update/versionPolicy.js";

describe("fork-aware version policy", () => {
  it("reports no action when upstream, installed fork, and published fork agree", () => {
    expect(evaluateVersionPolicy({
      currentVersion: "0.5.40-fork.1",
      upstreamLatestVersion: "0.5.40",
      forkLatestVersion: "0.5.40-fork.1",
    })).toMatchObject({
      forkUpdateAvailable: false,
      upstreamUpdatePending: false,
      integratedUpstreamVersion: "0.5.40",
    });
  });

  it("marks a newer upstream as pending without offering the official package", () => {
    expect(evaluateVersionPolicy({
      currentVersion: "0.5.40-fork.1",
      upstreamLatestVersion: "0.5.41",
      forkLatestVersion: "0.5.40-fork.1",
    })).toMatchObject({
      forkUpdateAvailable: false,
      upstreamUpdatePending: true,
    });
  });

  it("uses full SemVer ordering for newer fork prereleases", () => {
    expect(evaluateVersionPolicy({
      currentVersion: "0.5.40-fork.9",
      upstreamLatestVersion: "0.5.40",
      forkLatestVersion: "0.5.40-fork.10",
    })).toMatchObject({
      forkUpdateAvailable: true,
      upstreamUpdatePending: false,
    });
  });

  it("does not invent updates from invalid registry versions", () => {
    expect(evaluateVersionPolicy({
      currentVersion: "0.5.40-fork.1",
      upstreamLatestVersion: "not-semver",
      forkLatestVersion: "0.5.40-fork.01",
    })).toMatchObject({
      forkLatestVersion: null,
      upstreamLatestVersion: null,
      forkUpdateAvailable: false,
      upstreamUpdatePending: false,
    });

    expect(evaluateVersionPolicy({
      currentVersion: "broken",
      upstreamLatestVersion: "0.5.41",
      forkLatestVersion: "also-broken",
    })).toMatchObject({
      currentVersion: null,
      forkLatestVersion: null,
      forkUpdateAvailable: false,
      upstreamUpdatePending: false,
    });

    expect(evaluateVersionPolicy({
      currentVersion: "0.5.40-fork.1",
      upstreamLatestVersion: "0.5.41",
      forkLatestVersion: "0.5.41",
    })).toMatchObject({
      forkLatestVersion: null,
      forkUpdateAvailable: false,
      upstreamUpdatePending: true,
    });
  });

  it("queries and caches upstream and fork channels independently", async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url === registryLatestUrl("9router")) {
        return Response.json({ version: "0.5.41" });
      }
      return new Response("registry unavailable", { status: 503 });
    });
    const cache = new Map();
    const now = vi.fn(() => 1000);

    const first = await getVersionStatus({
      currentVersion: "0.5.40-fork.1",
      fetchImpl,
      cache,
      now,
    });
    const second = await getVersionStatus({
      currentVersion: "0.5.40-fork.1",
      fetchImpl,
      cache,
      now,
    });

    expect(first).toMatchObject({
      forkLatestVersion: null,
      upstreamLatestVersion: "0.5.41",
      forkUpdateAvailable: false,
      upstreamUpdatePending: true,
      updatePackageName: "@loldlm1/9router",
      installCommand: "npm i -g @loldlm1/9router@latest --prefer-online",
    });
    expect(second).toMatchObject(first);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
