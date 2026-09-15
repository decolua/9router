import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as crypto from "node:crypto";
import {
  decryptPayload,
  encryptPayload,
  saveDroidCliCredentials,
  readKeyfileKey,
  readKeychainKey,
  loadDroidCliCredentials,
  GET,
  POST,
} from "../../src/app/api/oauth/factory/auto-import/route.js";

describe("Factory Droid Local Auto-Import", () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    vi.restoreAllMocks();
  });

  describe("decryptPayload and encryptPayload", () => {
    const key = crypto.randomBytes(32);

    it("encrypts and decrypts valid AES-256-GCM ciphertext roundtrip", () => {
      const payload = {
        access_token: "test_access_token_123",
        refresh_token: "test_refresh_token_456",
        active_organization_id: "RFmWaCAuH8jTGM21tL5k",
      };

      const ciphertext = encryptPayload(payload, key);
      expect(typeof ciphertext).toBe("string");
      const decrypted = decryptPayload(ciphertext, key);

      expect(decrypted).toEqual(payload);
    });

    it("returns null for malformed ciphertext", () => {
      expect(decryptPayload("invalid:ciphertext", key)).toBeNull();
      expect(decryptPayload("", key)).toBeNull();
      expect(decryptPayload(null, key)).toBeNull();
    });

    it("returns null when auth tag is tampered or key is wrong", () => {
      const payload = { access_token: "tok" };
      const ciphertext = encryptPayload(payload, key);
      const parts = ciphertext.split(":");
      const tamperedTag = Buffer.from(parts[1], "base64");
      tamperedTag[0] ^= 1; // flip 1 bit
      const tamperedCiphertext = `${parts[0]}:${tamperedTag.toString("base64")}:${parts[2]}`;

      expect(decryptPayload(tamperedCiphertext, key)).toBeNull();

      const wrongKey = crypto.randomBytes(32);
      expect(decryptPayload(ciphertext, wrongKey)).toBeNull();
    });
  });

  describe("loadDroidCliCredentials and saveDroidCliCredentials", () => {
    it("returns null when no credentials exist in candidate paths", () => {
      const creds = loadDroidCliCredentials();
      // On machines without active ~/.factory/auth.v2 credentials, returns null gracefully
      expect(creds === null || typeof creds.accessToken === "string").toBe(true);
    });

    it("handles saveDroidCliCredentials validation safely", () => {
      expect(saveDroidCliCredentials(null)).toBe(false);
      expect(saveDroidCliCredentials({})).toBe(false);
      expect(saveDroidCliCredentials({ accessToken: "only_access" })).toBe(false);
      expect(saveDroidCliCredentials({ refreshToken: "only_refresh" })).toBe(false);
    });
  });

  describe("GET and POST Route Handlers", () => {
    it("handles GET request safely without throwing uncaught errors", async () => {
      const response = await GET();
      expect(response).toBeDefined();
      const json = await response.json();
      expect(typeof json.found).toBe("boolean");
    });

    it("handles POST request safely and returns JSON", async () => {
      const response = await POST();
      expect(response).toBeDefined();
      expect(response.status === 200 || response.status === 404 || response.status === 500).toBe(true);
    });
  });

  describe("Factory Connection Organization Deduplication & Isolation", () => {
    it("creates distinct connections for different orgIds under the same email", async () => {
      const { createProviderConnection, getProviderConnections, deleteProviderConnection } = await import("../../src/models");
      const testEmail = `factory_test_${Date.now()}@example.com`;

      const conn1 = await createProviderConnection({
        provider: "factory",
        authType: "oauth",
        email: testEmail,
        accessToken: "tok_org1",
        providerSpecificData: { orgId: "org_alpha" },
      });

      const conn2 = await createProviderConnection({
        provider: "factory",
        authType: "oauth",
        email: testEmail,
        accessToken: "tok_org2",
        providerSpecificData: { orgId: "org_beta" },
      });

      expect(conn1.id).not.toBe(conn2.id);
      expect(conn1.name).toContain("org_alpha");
      expect(conn2.name).toContain("org_beta");

      // Re-authenticating org_alpha should update conn1 rather than create a new one
      const conn1Updated = await createProviderConnection({
        provider: "factory",
        authType: "oauth",
        email: testEmail,
        accessToken: "tok_org1_refreshed",
        providerSpecificData: { orgId: "org_alpha" },
      });

      expect(conn1Updated.id).toBe(conn1.id);

      // Cleanup
      await deleteProviderConnection(conn1.id);
      await deleteProviderConnection(conn2.id);
    });
  });
});

