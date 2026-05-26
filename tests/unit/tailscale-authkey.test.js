import { describe, expect, it } from "vitest";
import {
  buildTailscaleUpArgs,
  getTailscaleAuthKey,
} from "../../src/lib/tunnel/tailscale.js";

describe("tailscale auth key login args", () => {
  it("reads TAILSCALE_AUTHKEY from the environment", () => {
    expect(getTailscaleAuthKey({ TAILSCALE_AUTHKEY: " tskey-auth-test " })).toBe("tskey-auth-test");
  });

  it("adds the auth key to tailscale up", () => {
    expect(buildTailscaleUpArgs("router-dev", {
      TAILSCALE_AUTHKEY: "tskey-auth-test",
    })).toContain("--auth-key=tskey-auth-test");
  });

  it("keeps hostname and accept-routes arguments", () => {
    expect(buildTailscaleUpArgs("router-dev", {})).toEqual(
      expect.arrayContaining(["up", "--accept-routes", "--hostname=router-dev"]),
    );
  });
});
