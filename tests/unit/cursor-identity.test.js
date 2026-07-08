import { describe, it, expect } from "vitest";
import {
  CursorService,
  isAuth0Subject,
  isCursorEmail,
} from "../../src/lib/oauth/services/cursor.js";

describe("Cursor identity helpers", () => {
  const service = new CursorService();

  it("detects auth0 subjects and real emails", () => {
    expect(isAuth0Subject("auth0|user_01KPAE2JJWEDFV9S93VS4M5S5Z")).toBe(true);
    expect(isAuth0Subject("restacion@spscc.edu")).toBe(false);
    expect(isCursorEmail("restacion@spscc.edu")).toBe(true);
    expect(isCursorEmail("auth0|user_abc")).toBe(false);
  });

  it("does not treat auth0 sub as email from JWT", () => {
    const payload = Buffer.from(
      JSON.stringify({
        sub: "auth0|user_01KPAE2JJWEDFV9S93VS4M5S5Z",
      }),
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const token = `header.${payload}.sig`;
    const info = service.extractUserInfo(token);
    expect(info.email).toBeNull();
    expect(info.userId).toBe("auth0|user_01KPAE2JJWEDFV9S93VS4M5S5Z");
  });

  it("prefers cachedEmail over auth0 subject", () => {
    const payload = Buffer.from(
      JSON.stringify({ sub: "auth0|user_01KPAE2JJWEDFV9S93VS4M5S5Z" }),
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const token = `header.${payload}.sig`;

    const identity = service.resolveIdentity({
      accessToken: token,
      cachedEmail: "restacion@spscc.edu",
    });

    expect(identity.email).toBe("restacion@spscc.edu");
    expect(identity.name).toBe("restacion@spscc.edu");
    expect(identity.userId).toBe("auth0|user_01KPAE2JJWEDFV9S93VS4M5S5Z");
  });
});
