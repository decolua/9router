import { beforeEach, describe, expect, it, vi } from "vitest";

const originalFetch = global.fetch;

describe("version releases API", () => {
  beforeEach(() => {
    vi.resetModules();
    global.fetch = vi.fn(async () => new Response(JSON.stringify([
      {
        tag_name: "v0.4.68",
        name: "v0.4.68",
        html_url: "https://github.com/decolua/9router/releases/tag/v0.4.68",
        published_at: "2026-06-05T12:00:00Z",
        draft: false,
        prerelease: false,
      },
      {
        tag_name: "v0.4.65",
        name: "v0.4.65",
        html_url: "https://github.com/decolua/9router/releases/tag/v0.4.65",
        published_at: "2026-06-01T12:00:00Z",
        draft: false,
        prerelease: false,
      },
      {
        tag_name: "draft-ignored",
        draft: true,
      },
    ]), { status: 200 }));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns GitHub releases annotated for upgrade and downgrade installs", async () => {
    const { GET } = await import("../../src/app/api/version/releases/route.js");

    const response = await GET();
    const body = await response.json();

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/decolua/9router/releases?per_page=30",
      expect.objectContaining({ headers: expect.objectContaining({ "User-Agent": "9Router" }) }),
    );
    expect(body.currentVersion).toBe("0.4.67");
    expect(body.releases.map((release) => release.version)).toEqual(["0.4.68", "0.4.65"]);
    expect(body.releases[0]).toMatchObject({ direction: "upgrade", installCommand: "npm i -g 9router@0.4.68 --prefer-online" });
    expect(body.releases[1]).toMatchObject({ direction: "downgrade", installCommand: "npm i -g 9router@0.4.65 --prefer-online" });
  });
});
