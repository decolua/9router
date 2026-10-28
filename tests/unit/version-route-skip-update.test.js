import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SKIP_UPDATE_ENV = "NINEROUTER_SKIP_UPDATE";
const httpsMock = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("https", () => ({ default: httpsMock }));

const { GET } = await import("../../src/app/api/version/route.js");

// Reply like the npm registry does, with a version far ahead of the installed one.
function npmRegistryRepliesWith(version) {
  httpsMock.get.mockImplementation((_url, _options, onResponse) => {
    const response = {
      on(event, handler) {
        handler(event === "data" ? JSON.stringify({ version }) : undefined);
        return response;
      },
    };
    onResponse(response);
    return { on() {} };
  });
}

describe("GET /api/version", () => {
  beforeEach(() => {
    delete process.env[SKIP_UPDATE_ENV];
    global.__npmVersionCache.value = null;
    global.__npmVersionCache.fetchedAt = 0;
    httpsMock.get.mockReset();
  });

  afterEach(() => {
    delete process.env[SKIP_UPDATE_ENV];
  });

  it("advertises a newer version when the update check runs", async () => {
    npmRegistryRepliesWith("99.0.0");

    const body = await (await GET()).json();

    expect(httpsMock.get).toHaveBeenCalled();
    expect(body.hasUpdate).toBe(true);
  });

  it("skips the npm lookup and the notice when the update check is disabled", async () => {
    process.env[SKIP_UPDATE_ENV] = "1";
    npmRegistryRepliesWith("99.0.0");

    const body = await (await GET()).json();

    expect(httpsMock.get).not.toHaveBeenCalled();
    expect(body.latestVersion).toBeNull();
    expect(body.hasUpdate).toBe(false);
  });
});
