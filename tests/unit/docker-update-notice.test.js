import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { npmGet } = vi.hoisted(() => ({ npmGet: vi.fn() }));
vi.mock("https", () => ({ default: { get: npmGet } }));

const hubManifest = "https://registry-1.docker.io/v2/decolua/9router/manifests/99.0.0";
const ghcrManifest = "https://ghcr.io/v2/decolua/9router/manifests/99.0.0";

function npmReturns(version) {
  npmGet.mockImplementation((_url, _options, callback) => {
    queueMicrotask(() => {
      const response = new EventEmitter();
      callback(response);
      response.emit("data", JSON.stringify({ version }));
      response.emit("end");
    });
    return new EventEmitter();
  });
}

function registryResponds({ hub = 200, ghcr = 200 } = {}) {
  fetch.mockImplementation(async (url) => {
    if (url === hubManifest) return new Response(null, { status: hub });
    if (url === ghcrManifest) return new Response(null, { status: ghcr });
    if (url.startsWith("https://auth.docker.io/token?")) return Response.json({ token: "docker-token" });
    if (url.startsWith("https://ghcr.io/token?")) return Response.json({ token: "ghcr-token" });
    throw new Error(`unexpected URL: ${url}`);
  });
}

async function checkVersion() {
  const { GET } = await import("../../src/app/api/version/route.js");
  return (await GET()).json();
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal("__npmVersionCache", { value: null, fetchedAt: 0 });
  vi.stubEnv("NINEROUTER_INSTALL", "docker");
  npmReturns("99.0.0");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("update availability for Docker installations", () => {
  it("publishes pull references after checking the exact version on both official registries", async () => {
    registryResponds();
    expect(await checkVersion()).toMatchObject({
      latestVersion: "99.0.0", hasUpdate: true,
      dockerImages: ["decolua/9router:99.0.0", "ghcr.io/decolua/9router:99.0.0"],
    });
    expect(fetch).toHaveBeenCalledWith(hubManifest, expect.objectContaining({
      method: "HEAD", headers: expect.objectContaining({ Authorization: "Bearer docker-token" }),
    }));
    expect(fetch).toHaveBeenCalledWith(ghcrManifest, expect.objectContaining({
      method: "HEAD", headers: expect.objectContaining({ Authorization: "Bearer ghcr-token" }),
    }));
    await checkVersion();
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it.each([{ hub: 404 }, { ghcr: 404 }, { hub: 429 }, { ghcr: 503 }])(
    "suppresses the Docker notice if publication cannot be verified (%j)", async (statuses) => {
      registryResponds(statuses);
      expect(await checkVersion()).toMatchObject({ latestVersion: null, hasUpdate: false, dockerImages: [] });
    },
  );

  it("suppresses the Docker notice when a registry request fails", async () => {
    fetch.mockRejectedValue(new Error("network unavailable"));
    expect(await checkVersion()).toMatchObject({ latestVersion: null, hasUpdate: false });
  });

  it.each(["0.0.0", "99.0.0-rc.1"])("does not probe registries for npm version %s", async (version) => {
    npmReturns(version);
    expect(await checkVersion()).toMatchObject({ latestVersion: null, hasUpdate: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the existing npm notice and response shape for other installations", async () => {
    vi.stubEnv("NINEROUTER_INSTALL", undefined);
    const result = await checkVersion();
    expect(result).toEqual({ currentVersion: expect.any(String), latestVersion: "99.0.0", hasUpdate: true });
    expect(fetch).not.toHaveBeenCalled();
  });
});
