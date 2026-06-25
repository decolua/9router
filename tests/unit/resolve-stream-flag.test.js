// #2031 — forceStream (stream-only) providers must keep streaming even when the
// client asks for a non-streaming/JSON response. 9Router then accumulates the
// provider's stream and returns a normal JSON body to the client.
import { describe, it, expect } from "vitest";
import { resolveStreamFlag } from "../../open-sse/handlers/chatCore/streamFlag.js";

describe("resolveStreamFlag (#2031)", () => {
  it("keeps streaming for a forceStream provider even when client prefers JSON and sets stream:false", () => {
    // The bug: this returned false, sending stream:false to a stream-only
    // provider (e.g. CommandCode) → 400 Bad Request.
    expect(
      resolveStreamFlag({
        providerRequiresStreaming: true,
        bodyStream: false,
        clientPrefersJson: true,
        clientPrefersSSE: false,
      })
    ).toBe(true);
  });

  it("non-forceStream provider: client prefers JSON + stream:false → non-streaming (unchanged)", () => {
    expect(
      resolveStreamFlag({
        providerRequiresStreaming: false,
        bodyStream: false,
        clientPrefersJson: true,
        clientPrefersSSE: false,
      })
    ).toBe(false);
  });

  it("forceStream provider streams by default when no stream flag is given", () => {
    expect(resolveStreamFlag({ providerRequiresStreaming: true })).toBe(true);
  });

  it("forceNonStreaming (e.g. image-gen) still wins over forceStream", () => {
    expect(
      resolveStreamFlag({ providerRequiresStreaming: true, forceNonStreaming: true })
    ).toBe(false);
  });

  it("ordinary provider with no special flags streams by default", () => {
    expect(resolveStreamFlag({ providerRequiresStreaming: false })).toBe(true);
  });
});
