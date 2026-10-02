import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn((_url, _options, callback) => {
  const response = {
    on(event, handler) {
      if (event === "data") handler('{"version":"99.0.0"}');
      if (event === "end") handler();
      return response;
    },
  };
  callback(response);
  return { on: vi.fn() };
});

vi.mock("https", () => ({ default: { get } }));
vi.mock("fs", () => ({ default: {
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => ""),
} }));

describe("version route", () => {
  beforeEach(() => {
    global.__npmVersionCache = { value: null, fetchedAt: 0 };
    delete process.env.DOCKER_UPDATE_TRIGGER_FILE;
  });

  it("reports Docker as the update method inside a container", async () => {
    const { GET } = await import("../../src/app/api/version/route.js");
    const response = await GET();
    const body = await response.json();

    expect(body.hasUpdate).toBe(true);
    expect(body.isDocker).toBe(true);
    expect(body.updateMethod).toBe("docker");
  });

  it("reports automatic Docker updates when a host trigger is configured", async () => {
    process.env.DOCKER_UPDATE_TRIGGER_FILE = "/app/data/update/docker-update.request";
    const { GET } = await import("../../src/app/api/version/route.js");
    const body = await (await GET()).json();

    expect(body.updateMethod).toBe("docker-auto");
  });
});
