import { describe, expect, it, vi } from "vitest";
import { dedupRefresh } from "../../open-sse/services/tokenRefresh/dedup.js";

describe("refresh result deduplication", () => {
  it("does not cache a null refresh result", async () => {
    const refresh = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ accessToken: "fresh-token" });

    expect(await dedupRefresh("null-result", "refresh-token", refresh)).toBeNull();
    await expect(dedupRefresh("null-result", "refresh-token", refresh)).resolves.toEqual({
      accessToken: "fresh-token",
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
