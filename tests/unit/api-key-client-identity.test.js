import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/utils/machineId", () => ({
  getPrivateMachineId: vi.fn().mockResolvedValue("server-secret"),
}));

import {
  getApiKeyClientIdentity,
  maskClientNetwork,
  normalizeClientId,
} from "@/lib/apiKeyClientIdentity.js";

function request(headers) {
  return { headers: new Headers(headers) };
}

describe("API key client identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("masks networks without storing a full address", () => {
    expect(maskClientNetwork("203.0.113.20")).toBe("203.0.113.*");
    expect(maskClientNetwork("2001:db8:abcd:12::1")).toBe("2001:db8:abcd::*");
    expect(maskClientNetwork("127.0.0.1")).toBe("Local");
  });

  it("accepts compact client IDs and rejects unsafe values", () => {
    expect(normalizeClientId("home-pc.codex")).toBe("home-pc.codex");
    expect(normalizeClientId("bad value")).toBeNull();
    expect(normalizeClientId("x".repeat(65))).toBeNull();
  });

  it("builds stable HMAC identity from trusted IP and client family", async () => {
    const first = await getApiKeyClientIdentity(request({
      "user-agent": "codex_cli_rs/0.144.1",
      "x-9r-real-ip": "203.0.113.20",
      "x-9r-ip-source": "cloudflare",
    }));
    const second = await getApiKeyClientIdentity(request({
      "user-agent": "codex_cli_rs/0.144.1",
      "x-9r-real-ip": "203.0.113.20",
      "x-9r-ip-source": "cloudflare",
    }));

    expect(first).toEqual(second);
    expect(first.clientFamily).toBe("codex");
    expect(first.maskedNetwork).toBe("203.0.113.*");
    expect(first.fingerprint).toMatch(/^[a-f0-9]{32}$/);
  });

  it("keeps generic client identity stable across version upgrades", async () => {
    const first = await getApiKeyClientIdentity(request({
      "user-agent": "curl/8.10.0",
      "x-9r-real-ip": "203.0.113.20",
    }));
    const second = await getApiKeyClientIdentity(request({
      "user-agent": "curl/8.11.0",
      "x-9r-real-ip": "203.0.113.20",
    }));

    expect(first.clientFamily).toBe("curl");
    expect(first.fingerprint).toBe(second.fingerprint);
  });

  it("uses explicit client ID across network changes", async () => {
    const first = await getApiKeyClientIdentity(request({
      "x-9router-client-id": "home-pc",
      "x-9r-real-ip": "203.0.113.20",
    }));
    const second = await getApiKeyClientIdentity(request({
      "x-9router-client-id": "home-pc",
      "x-9r-real-ip": "198.51.100.40",
    }));

    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.maskedNetwork).not.toBe(second.maskedNetwork);
  });

  it("skips requests with neither trusted IP nor client ID", async () => {
    await expect(getApiKeyClientIdentity(request({
      "user-agent": "codex_cli_rs/0.144.1",
    }))).resolves.toBeNull();
  });
});
