import { describe, expect, it } from "vitest";
import * as proxyFetch from "../../open-sse/utils/proxyFetch.js";

describe("proxy URL log redaction", () => {
  it("removes credentials, path, query, and fragment", () => {
    expect(proxyFetch.redactProxyUrlForLog?.(
      "https://user:secret@relay.test:8443/private/path?token=secret#fragment",
    )).toBe("https://relay.test:8443");
  });

  it("does not echo malformed proxy input", () => {
    expect(proxyFetch.redactProxyUrlForLog?.("not a valid relay URL"))
      .toBe("[invalid proxy URL]");
  });
});
