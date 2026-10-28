// Client half of settings re-auth: the dashboard must be able to complete a security
// downgrade after the server answers REAUTH_REQUIRED, and must not retry anything else.
import { describe, it, expect, vi } from "vitest";
import { fetchWithReauth } from "@/shared/utils/reauthFetch.js";
import useSettingsStore from "@/store/settingsStore.js";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const PATCH = { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requireLogin: false }) };

describe("fetchWithReauth", () => {
  it("prompts once and retries with currentPassword on REAUTH_REQUIRED", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(json(401, { code: "REAUTH_REQUIRED", fields: ["requireLogin"] }))
      .mockResolvedValueOnce(json(200, { requireLogin: false }));
    const ask = vi.fn().mockResolvedValue("hunter2");

    const res = await fetchWithReauth("/api/settings", PATCH, ask, fetchFn);

    expect(res.status).toBe(200);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchFn.mock.calls[1][1].body)).toEqual({ requireLogin: false, currentPassword: "hunter2" });
    expect(fetchFn.mock.calls[1][1].method).toBe("PATCH");
  });

  it("returns the original 401 when the prompt is cancelled", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(json(401, { code: "REAUTH_REQUIRED" }));
    const res = await fetchWithReauth("/api/settings", PATCH, vi.fn().mockResolvedValue(null), fetchFn);
    expect(res.status).toBe(401);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("does not prompt for other 401s or for successful responses", async () => {
    const ask = vi.fn();
    const unauth = await fetchWithReauth("/api/settings", PATCH, ask, vi.fn().mockResolvedValue(json(401, { error: "Unauthorized" })));
    const ok = await fetchWithReauth("/api/settings", PATCH, ask, vi.fn().mockResolvedValue(json(200, {})));
    expect(unauth.status).toBe(401);
    expect(ok.status).toBe(200);
    expect(ask).not.toHaveBeenCalled();
  });
});

describe("settingsStore.patchSettings fetchImpl", () => {
  it("sends the PATCH through the supplied fetch and merges the result", async () => {
    useSettingsStore.setState({ settings: { hasPassword: true, requireApiKey: true } });
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { requireApiKey: false }));

    const updated = await useSettingsStore.getState().patchSettings({ requireApiKey: false }, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith("/api/settings", expect.objectContaining({ method: "PATCH" }));
    expect(updated).toEqual({ requireApiKey: false });
    expect(useSettingsStore.getState().settings).toEqual({ hasPassword: true, requireApiKey: false });
  });

  it("leaves state unchanged when the change is refused", async () => {
    useSettingsStore.setState({ settings: { requireApiKey: true } });
    const updated = await useSettingsStore.getState().patchSettings(
      { requireApiKey: false },
      { fetchImpl: vi.fn().mockResolvedValue(json(401, { code: "REAUTH_REQUIRED" })) }
    );
    expect(updated).toBeNull();
    expect(useSettingsStore.getState().settings).toEqual({ requireApiKey: true });
  });
});
