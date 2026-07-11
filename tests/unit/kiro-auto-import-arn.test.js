import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Regression test for the Kiro auto-import route.
 *
 * Before this fix, the route rewrote the region segment of Kiro IDE's
 * profileArn to `us-east-1` on the assumption that "the runtime gateway
 * requires us-east-1". That assumption held only for Builder ID / social
 * accounts. IDC users signed in through eu-west-1 (or any non-us region)
 * were silently pinned to a us-east-1 profile ARN, which their token has no
 * permission to sign with — every subsequent generateAssistantResponse /
 * GetUsageLimits call 403s.
 *
 * The route must preserve the ARN's region exactly as issued by Kiro IDE.
 *
 * The route uses `fs/promises` and `next/server`, so we mock both. We import
 * the route dynamically after mocks are wired.
 */
describe("kiro auto-import — preserves profileArn region", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.restoreAllMocks());

  async function loadRoute(fsMock) {
    vi.doMock("fs/promises", () => fsMock);
    vi.doMock("next/server", () => ({
      NextResponse: {
        json: (body, init) => ({ status: init?.status ?? 200, body }),
      },
    }));
    return await import("../../src/app/api/oauth/kiro/auto-import/route.js");
  }

  it("returns the ARN unchanged for a non-us-east-1 IDC account", async () => {
    const idcArn = "arn:aws:codewhisperer:eu-west-1:123456789012:profile/EU";
    const tokenFile = JSON.stringify({
      refreshToken: "aorAAAAAG-eu-west-1-refresh",
      region: "eu-west-1",
      authMethod: "idc",
      clientIdHash: "abc123",
    });
    const clientFile = JSON.stringify({
      clientId: "client-id",
      clientSecret: "client-secret",
    });
    const profileFile = JSON.stringify({ arn: idcArn });

    const fsMock = {
      readdir: vi.fn(async () => ["kiro-auth-token.json", "abc123.json"]),
      readFile: vi.fn(async (path) => {
        const p = String(path);
        if (p.endsWith("kiro-auth-token.json")) return tokenFile;
        if (p.endsWith("abc123.json")) return clientFile;
        if (p.endsWith("profile.json")) return profileFile;
        throw new Error(`unexpected read: ${p}`);
      }),
    };

    const { GET } = await loadRoute(fsMock);
    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.refreshToken).toBe("aorAAAAAG-eu-west-1-refresh");
    expect(res.body.region).toBe("eu-west-1");
    expect(res.body.authMethod).toBe("idc");
    expect(res.body.clientId).toBe("client-id");
    expect(res.body.clientSecret).toBe("client-secret");
    // The critical assertion: no region rewrite. The ARN's region segment
    // must still be eu-west-1, not us-east-1.
    expect(res.body.profileArn).toBe(idcArn);
    expect(res.body.profileArn).toMatch(
      /^arn:aws:codewhisperer:eu-west-1:/
    );
  });

  it("still returns a us-east-1 ARN unchanged for Builder ID accounts", async () => {
    const builderArn = "arn:aws:codewhisperer:us-east-1:638616132270:profile/BUILDER";
    const tokenFile = JSON.stringify({
      refreshToken: "aorAAAAAG-builder",
      region: "us-east-1",
      authMethod: "builder-id",
    });
    const profileFile = JSON.stringify({ arn: builderArn });

    const fsMock = {
      readdir: vi.fn(async () => ["kiro-auth-token.json"]),
      readFile: vi.fn(async (path) => {
        const p = String(path);
        if (p.endsWith("kiro-auth-token.json")) return tokenFile;
        if (p.endsWith("profile.json")) return profileFile;
        throw new Error(`unexpected read: ${p}`);
      }),
    };

    const { GET } = await loadRoute(fsMock);
    const res = await GET();

    expect(res.body.found).toBe(true);
    expect(res.body.profileArn).toBe(builderArn);
  });
});
