import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearAwsCredentialCache,
  detectCredentialMode,
  resolveAwsCredentials,
  resolveRegion,
} from "../../open-sse/shared/awsCredentials.js";
import { AWS_CREDENTIAL_MODE } from "../../open-sse/config/awsConstants.js";

const STATIC_CONNECTION = {
  apiKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  providerSpecificData: {
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    region: "eu-west-1",
  },
};

const PROFILE_CONNECTION = {
  providerSpecificData: { profile: "my-sso-profile", region: "us-west-2" },
};

/** Stand-in for @aws-sdk/credential-providers so the suite needs no AWS dependency. */
function fakeSdk(fromIniImpl) {
  return { fromIni: vi.fn(() => fromIniImpl) };
}

beforeEach(() => {
  clearAwsCredentialCache();
});

describe("AWS credential mode detection", () => {
  it("treats a named profile as profile mode", () => {
    expect(detectCredentialMode(PROFILE_CONNECTION)).toBe(
      AWS_CREDENTIAL_MODE.PROFILE,
    );
  });

  it("treats bare keys as static mode", () => {
    expect(detectCredentialMode(STATIC_CONNECTION)).toBe(
      AWS_CREDENTIAL_MODE.STATIC,
    );
  });

  it("prefers the profile when both are somehow present", () => {
    // A user who filled in a profile meant to use it; silently signing with a stale pasted
    // key instead would be the wrong guess.
    expect(
      detectCredentialMode({
        ...STATIC_CONNECTION,
        providerSpecificData: {
          ...STATIC_CONNECTION.providerSpecificData,
          profile: "p",
        },
      }),
    ).toBe(AWS_CREDENTIAL_MODE.PROFILE);
  });
});

describe("AWS region resolution", () => {
  it("prefers the connection setting over the environment", () => {
    expect(resolveRegion(STATIC_CONNECTION, { AWS_REGION: "ap-south-1" })).toBe(
      "eu-west-1",
    );
  });

  it("falls back to AWS_REGION, then AWS_DEFAULT_REGION, then the Bedrock default", () => {
    expect(resolveRegion({}, { AWS_REGION: "ap-south-1" })).toBe("ap-south-1");
    expect(resolveRegion({}, { AWS_DEFAULT_REGION: "sa-east-1" })).toBe(
      "sa-east-1",
    );
    expect(resolveRegion({}, {})).toBe("us-east-1");
  });
});

describe("static credential mode", () => {
  it("uses the API key as the secret and returns the configured region", async () => {
    await expect(
      resolveAwsCredentials(STATIC_CONNECTION),
    ).resolves.toMatchObject({
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      region: "eu-west-1",
      mode: AWS_CREDENTIAL_MODE.STATIC,
    });
  });

  it("passes a session token through for STS-derived keys", async () => {
    const resolved = await resolveAwsCredentials({
      apiKey: "secret",
      providerSpecificData: {
        accessKeyId: "ASIATEMPORARY",
        sessionToken: "tok",
      },
    });
    expect(resolved.sessionToken).toBe("tok");
  });

  it("explains what is missing rather than emitting a broken signature", async () => {
    await expect(
      resolveAwsCredentials({ providerSpecificData: { accessKeyId: "AKIA" } }),
    ).rejects.toThrow(/incomplete/);
  });

  it("catches a temporary key with no session token, which would 403 upstream", async () => {
    // ASIA-prefixed keys are always temporary; without the token AWS returns an opaque
    // SignatureDoesNotMatch, so fail early with the actual fix.
    await expect(
      resolveAwsCredentials({
        apiKey: "secret",
        providerSpecificData: { accessKeyId: "ASIAXXXXXXXX" },
      }),
    ).rejects.toThrow(/sessionToken/);
  });
});

describe("profile / SSO credential mode", () => {
  it("resolves through the AWS SDK for the named profile", async () => {
    const sdk = fakeSdk(async () => ({
      accessKeyId: "ASIASSO",
      secretAccessKey: "sso-secret",
      sessionToken: "sso-token",
      expiration: new Date("2030-01-01T00:00:00Z"),
    }));

    const resolved = await resolveAwsCredentials(PROFILE_CONNECTION, {
      loadCredentialProviders: async () => sdk,
    });

    expect(sdk.fromIni).toHaveBeenCalledWith({ profile: "my-sso-profile" });
    expect(resolved).toMatchObject({
      accessKeyId: "ASIASSO",
      sessionToken: "sso-token",
      region: "us-west-2",
      mode: AWS_CREDENTIAL_MODE.PROFILE,
    });
  });

  it("tells the user to run aws sso login when resolution fails", async () => {
    const sdk = fakeSdk(async () => {
      throw new Error("Token is expired");
    });

    await expect(
      resolveAwsCredentials(PROFILE_CONNECTION, {
        loadCredentialProviders: async () => sdk,
      }),
    ).rejects.toThrow(/aws sso login --profile my-sso-profile/);
  });

  it("gives an actionable error when the optional AWS SDK is not installed", async () => {
    await expect(
      resolveAwsCredentials(PROFILE_CONNECTION, {
        loadCredentialProviders: async () => {
          throw new Error("Cannot find module");
        },
      }),
    ).rejects.toThrow(/@aws-sdk\/credential-providers/);
  });

  it("rejects a profile that resolves without usable keys", async () => {
    const sdk = fakeSdk(async () => ({}));
    await expect(
      resolveAwsCredentials(PROFILE_CONNECTION, {
        loadCredentialProviders: async () => sdk,
      }),
    ).rejects.toThrow(/without usable credentials/);
  });
});

describe("credential caching and refresh", () => {
  const expiringSdk = (expiresAtMs) =>
    fakeSdk(async () => ({
      accessKeyId: "ASIASSO",
      secretAccessKey: "sso-secret",
      sessionToken: "sso-token",
      expiration: new Date(expiresAtMs),
    }));

  it("reuses a live credential instead of re-hitting SSO on every request", async () => {
    const t0 = 1_000_000_000_000;
    const sdk = expiringSdk(t0 + 3_600_000);
    const opts = { loadCredentialProviders: async () => sdk };

    await resolveAwsCredentials(PROFILE_CONNECTION, { ...opts, now: () => t0 });
    await resolveAwsCredentials(PROFILE_CONNECTION, {
      ...opts,
      now: () => t0 + 60_000,
    });

    expect(sdk.fromIni).toHaveBeenCalledTimes(1);
  });

  it("re-resolves before expiry so a stream cannot outlive its signing key", async () => {
    const t0 = 1_000_000_000_000;
    const sdk = expiringSdk(t0 + 3_600_000);
    const opts = { loadCredentialProviders: async () => sdk };

    await resolveAwsCredentials(PROFILE_CONNECTION, { ...opts, now: () => t0 });
    // 5 minutes of refresh lead: at expiry-minus-4-minutes the cache must already be stale.
    await resolveAwsCredentials(PROFILE_CONNECTION, {
      ...opts,
      now: () => t0 + 3_600_000 - 4 * 60_000,
    });

    expect(sdk.fromIni).toHaveBeenCalledTimes(2);
  });

  it("collapses concurrent requests into a single SSO resolution", async () => {
    const sdk = expiringSdk(Date.now() + 3_600_000);
    const opts = { loadCredentialProviders: async () => sdk };

    await Promise.all([
      resolveAwsCredentials(PROFILE_CONNECTION, opts),
      resolveAwsCredentials(PROFILE_CONNECTION, opts),
      resolveAwsCredentials(PROFILE_CONNECTION, opts),
    ]);

    // Without in-flight sharing, a burst of traffic would fan out into one SSO call each.
    expect(sdk.fromIni).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failure, so the next attempt retries", async () => {
    let attempt = 0;
    const sdk = {
      fromIni: vi.fn(() => async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("Token is expired");
        return {
          accessKeyId: "ASIASSO",
          secretAccessKey: "s",
          sessionToken: "t",
          expiration: null,
        };
      }),
    };
    const opts = { loadCredentialProviders: async () => sdk };

    await expect(
      resolveAwsCredentials(PROFILE_CONNECTION, opts),
    ).rejects.toThrow();
    // After the user runs `aws sso login`, the very next request must succeed.
    await expect(
      resolveAwsCredentials(PROFILE_CONNECTION, opts),
    ).resolves.toMatchObject({
      accessKeyId: "ASIASSO",
    });
  });

  it("keys the cache per profile so two connections do not share credentials", async () => {
    const sdk = expiringSdk(Date.now() + 3_600_000);
    const opts = { loadCredentialProviders: async () => sdk };

    await resolveAwsCredentials(PROFILE_CONNECTION, opts);
    await resolveAwsCredentials(
      { providerSpecificData: { profile: "other-profile" } },
      opts,
    );

    expect(sdk.fromIni).toHaveBeenCalledTimes(2);
    expect(sdk.fromIni).toHaveBeenLastCalledWith({ profile: "other-profile" });
  });
});

// Regression tests for findings from the pre-merge adversarial review. Each of these passed
// silently before the fix, which is why they exist.
describe("credential isolation and freshness (adversarial review regressions)", () => {
  it("rejects a region that would redirect the request to another host", () => {
    // The region is interpolated into the Bedrock hostname, so "evil.com/x" would resolve the
    // host to "bedrock-runtime.evil.com" and ship the signed body and session token there.
    for (const region of [
      "evil.com/x",
      "foo@evil.com",
      "us-east-1/../x",
      "UPPER-1",
      "a".repeat(64),
    ]) {
      expect(() => resolveRegion({ providerSpecificData: { region } })).toThrow(
        /Invalid AWS region/,
      );
    }
    expect(
      resolveRegion({ providerSpecificData: { region: "ap-southeast-3" } }),
    ).toBe("ap-southeast-3");
  });

  it("absorbs a pasted trailing space and names where a bad region came from", () => {
    // A trailing space is a typo to trim, not a reason to fail every request.
    expect(resolveRegion({ providerSpecificData: { region: " us-east-1 " } }, {})).toBe("us-east-1");

    // Saying which source was bad stops an operator hunting in the dashboard for a shell problem.
    expect(() => resolveRegion({}, { AWS_REGION: "evil.com/x" })).toThrow(
      /AWS_REGION environment variable/,
    );
    expect(() => resolveRegion({ providerSpecificData: { region: "evil.com/x" } }, {})).toThrow(
      /providerSpecificData\.region/,
    );
  });

  it("picks up a rotated secret immediately instead of serving a cached one", async () => {
    const conn = (secret) => ({
      apiKey: secret,
      providerSpecificData: { accessKeyId: "AKIASAME", region: "us-east-1" },
    });
    await resolveAwsCredentials(conn("SECRET-OLD"));
    // Static resolution does no I/O, so caching it only ever hid a corrected secret.
    await expect(
      resolveAwsCredentials(conn("SECRET-NEW")),
    ).resolves.toMatchObject({
      secretAccessKey: "SECRET-NEW",
    });
  });

  it("never serves one connection's secret to another sharing an access key id", async () => {
    const a = await resolveAwsCredentials({
      apiKey: "tenant1-secret",
      providerSpecificData: { accessKeyId: "AKIASHARED" },
    });
    const b = await resolveAwsCredentials({
      apiKey: "tenant2-secret",
      providerSpecificData: { accessKeyId: "AKIASHARED" },
    });
    expect(a.secretAccessKey).toBe("tenant1-secret");
    expect(b.secretAccessKey).toBe("tenant2-secret");
  });

  it("keeps each concurrent caller's own region while sharing one SSO resolution", async () => {
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const sdk = {
      fromIni: vi.fn(() => async () => {
        await gate;
        return {
          accessKeyId: "ASIA",
          secretAccessKey: "s",
          sessionToken: "t",
          expiration: new Date(Date.now() + 3_600_000),
        };
      }),
    };
    const opts = { loadCredentialProviders: async () => sdk };

    const first = resolveAwsCredentials(
      { providerSpecificData: { profile: "shared", region: "us-east-1" } },
      opts,
    );
    const second = resolveAwsCredentials(
      { providerSpecificData: { profile: "shared", region: "eu-west-1" } },
      opts,
    );
    release();
    const [a, b] = await Promise.all([first, second]);

    // Sharing the credential promise must not leak the first caller's region: signing with the
    // wrong region produces an invalid credential scope and AWS rejects the request.
    expect(a.region).toBe("us-east-1");
    expect(b.region).toBe("eu-west-1");
    expect(sdk.fromIni).toHaveBeenCalledTimes(1);
  });

  it("gives a no-expiry profile credential a short TTL instead of re-reading ~/.aws per request", async () => {
    // fromIni returns no expiration for a plain aws_access_key_id profile in ~/.aws/credentials.
    // Treating that as instantly stale meant a disk read and INI parse on every single request.
    const sdk = {
      fromIni: vi.fn(() => async () => ({
        accessKeyId: "AKIA",
        secretAccessKey: "s",
        sessionToken: undefined,
        expiration: null,
      })),
    };
    const opts = { loadCredentialProviders: async () => sdk };
    const conn = { providerSpecificData: { profile: "plainkeys" } };
    const t0 = 1_000_000_000_000;

    for (let i = 0; i < 5; i += 1) {
      await resolveAwsCredentials(conn, { ...opts, now: () => t0 + i });
    }
    expect(sdk.fromIni).toHaveBeenCalledTimes(1);

    // But it must not be pinned for the process lifetime either: past the floor it re-resolves,
    // so a revoked profile stops working rather than being cached forever.
    await resolveAwsCredentials(conn, { ...opts, now: () => t0 + 61_000 });
    expect(sdk.fromIni).toHaveBeenCalledTimes(2);
  });
});

// Regressions for the third adversarial round (C4, C7).
describe("profile resolution bounds and validation", () => {
  it("times out a hung resolution instead of wedging every waiter on that profile", async () => {
    // All callers await the same in-flight promise, so an unbounded hang blocks every Bedrock
    // request on this profile forever.
    const sdk = { fromIni: vi.fn(() => () => new Promise(() => {})) };

    await expect(
      resolveAwsCredentials(
        { providerSpecificData: { profile: "hung" } },
        { loadCredentialProviders: async () => sdk, resolveTimeoutMs: 20 },
      ),
    ).rejects.toThrow(/timed out after/);

    // And the failure must not be cached, so the next attempt genuinely retries.
    await expect(
      resolveAwsCredentials(
        { providerSpecificData: { profile: "hung" } },
        { loadCredentialProviders: async () => sdk, resolveTimeoutMs: 20 },
      ),
    ).rejects.toThrow(/timed out after/);
    expect(sdk.fromIni).toHaveBeenCalledTimes(2);
  });

  it("rejects a profile name that is not a plausible AWS profile", async () => {
    // providerSpecificData has no schema, and the SDK will follow source_profile chains and run
    // a credential_process subprocess for whatever profile it is handed.
    for (const profile of ["../../etc/passwd", "a b", "x;y", "$(whoami)", "a".repeat(65)]) {
      await expect(
        resolveAwsCredentials({ providerSpecificData: { profile } }),
      ).rejects.toThrow(/Invalid AWS profile name/);
    }
  });

  it("accepts the profile shapes AWS actually allows", async () => {
    const sdk = fakeSdk(async () => ({
      accessKeyId: "ASIA",
      secretAccessKey: "s",
      sessionToken: "t",
      expiration: new Date(Date.now() + 3_600_000),
    }));
    for (const profile of ["default", "my-sso-profile", "acct_1.prod", "sso:role"]) {
      clearAwsCredentialCache();
      await expect(
        resolveAwsCredentials(
          { providerSpecificData: { profile } },
          { loadCredentialProviders: async () => sdk },
        ),
      ).resolves.toMatchObject({ accessKeyId: "ASIA" });
    }
  });
});
