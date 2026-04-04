import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("9remote config", () => {
  const originalEnabled = process.env.NEXT_PUBLIC_NINE_REMOTE_ENABLED;
  const originalPublicUrl = process.env.NEXT_PUBLIC_NINE_REMOTE_URL;
  const originalServerUrl = process.env.NINE_REMOTE_URL;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_NINE_REMOTE_ENABLED;
    delete process.env.NEXT_PUBLIC_NINE_REMOTE_URL;
    delete process.env.NINE_REMOTE_URL;
  });

  afterEach(() => {
    if (originalEnabled === undefined) delete process.env.NEXT_PUBLIC_NINE_REMOTE_ENABLED;
    else process.env.NEXT_PUBLIC_NINE_REMOTE_ENABLED = originalEnabled;

    if (originalPublicUrl === undefined) delete process.env.NEXT_PUBLIC_NINE_REMOTE_URL;
    else process.env.NEXT_PUBLIC_NINE_REMOTE_URL = originalPublicUrl;

    if (originalServerUrl === undefined) delete process.env.NINE_REMOTE_URL;
    else process.env.NINE_REMOTE_URL = originalServerUrl;
  });

  it("is disabled by default", async () => {
    const { isNineRemoteEnabled } = await import("../../src/lib/nineRemoteConfig.js");

    expect(isNineRemoteEnabled()).toBe(false);
  });

  it("enables 9remote only when explicit env flag is true", async () => {
    process.env.NEXT_PUBLIC_NINE_REMOTE_ENABLED = "true";

    const { isNineRemoteEnabled } = await import("../../src/lib/nineRemoteConfig.js");

    expect(isNineRemoteEnabled()).toBe(true);
  });

  it("uses env overrides for public and server urls", async () => {
    process.env.NEXT_PUBLIC_NINE_REMOTE_URL = "https://remote.example.com";
    process.env.NINE_REMOTE_URL = "http://127.0.0.1:2209";

    const { getNineRemotePublicUrl, getNineRemoteServerUrl } = await import("../../src/lib/nineRemoteConfig.js");

    expect(getNineRemotePublicUrl()).toBe("https://remote.example.com");
    expect(getNineRemoteServerUrl()).toBe("http://127.0.0.1:2209");
  });
});
