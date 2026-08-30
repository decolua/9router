import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validatePasswordStrength, isWeakPassword } from "@/lib/auth/passwordPolicy.js";
import { getInitialDashboardPassword } from "@/lib/auth/dashboardSession.js";
import { assertPublicUrl, parseIpv4ToInt, isBlockedIpv4, isBlockedIpv6 } from "@/shared/utils/ssrfGuard.js";
import { encryptSecret, decryptSecret } from "@/lib/crypto.js";
import { createProviderConnection, getProviderConnections, deleteProviderConnection } from "@/lib/db/repos/connectionsRepo.js";
import { __test__ as reqDetailsTest } from "@/lib/db/repos/requestDetailsRepo.js";

describe("Security Hardening Automated Unit Tests", () => {
  describe("Password Complexity & Policy (OWASP ASVS 6.1.1 / 6.1.2)", () => {
    it("should reject passwords shorter than 10 characters", () => {
      const result = validatePasswordStrength("Short1!");
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("at least 10 characters"))).toBe(true);
    });

    it("should reject common dictionary and weak passwords", () => {
      expect(isWeakPassword("123456")).toBe(true);
      expect(isWeakPassword("password")).toBe(true);
      expect(isWeakPassword("admin12345")).toBe(true);
      expect(isWeakPassword("qwertyuiop")).toBe(true);
      expect(isWeakPassword("1234567890")).toBe(true);
    });

    it("should reject repeating single character sequences", () => {
      const result = validatePasswordStrength("aaaaaaaaaaa1!");
      expect(result.valid).toBe(false);
    });

    it("should reject passwords with insufficient character diversity (< 3 classes)", () => {
      // Only lowercase and digits
      const result = validatePasswordStrength("alllowercase12345");
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("at least 3 categories"))).toBe(true);
    });

    it("should accept strong passwords meeting length and diversity criteria", () => {
      const result = validatePasswordStrength("Str0ng!Pass#2026");
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
      expect(isWeakPassword("Str0ng!Pass#2026")).toBe(false);
    });

    it("should generate a high-entropy random initial password when none is provided", () => {
      const oldEnv = process.env.INITIAL_PASSWORD;
      delete process.env.INITIAL_PASSWORD;
      try {
        const generated = getInitialDashboardPassword();
        expect(generated).toBeDefined();
        expect(generated.length).toBeGreaterThanOrEqual(16);
        expect(typeof generated).toBe("string");
      } finally {
        if (oldEnv) process.env.INITIAL_PASSWORD = oldEnv;
      }
    });
  });

  describe("SSRF Guard & Multi-Format IP Validation (OWASP ASVS 2.1.1 / 4.1.1 / 12.2.1)", () => {
    it("should parse and block decimal integer IPv4 literals", () => {
      // 2130706433 is 127.0.0.1
      const ipInt = parseIpv4ToInt("2130706433");
      expect(ipInt).toBe(0x7f000001);
      expect(isBlockedIpv4(ipInt)).toBe(true);
      expect(() => assertPublicUrl("http://2130706433/")).toThrow(/private IP/i);
    });

    it("should parse and block hexadecimal IPv4 literals", () => {
      // 0x7f000001 is 127.0.0.1
      const ipInt = parseIpv4ToInt("0x7f000001");
      expect(ipInt).toBe(0x7f000001);
      expect(isBlockedIpv4(ipInt)).toBe(true);
      expect(() => assertPublicUrl("http://0x7f000001/")).toThrow(/private IP/i);
    });

    it("should parse and block octal IPv4 literals", () => {
      // 0177.0.0.1 is 127.0.0.1
      const ipInt = parseIpv4ToInt("0177.0.0.1");
      expect(ipInt).toBe(0x7f000001);
      expect(isBlockedIpv4(ipInt)).toBe(true);
      expect(() => assertPublicUrl("http://0177.0.0.1/")).toThrow(/private IP/i);
    });

    it("should block cloud metadata and link-local ranges", () => {
      // 169.254.169.254 AWS/GCP metadata
      expect(() => assertPublicUrl("http://169.254.169.254/latest/meta-data")).toThrow(/private IP/i);
      // Decimal representation of 169.254.169.254
      expect(() => assertPublicUrl("http://2852039166/")).toThrow(/private IP/i);
    });

    it("should block private RFC 1918 networks", () => {
      expect(() => assertPublicUrl("http://10.0.0.1/")).toThrow(/private IP/i);
      expect(() => assertPublicUrl("http://172.16.0.1/")).toThrow(/private IP/i);
      expect(() => assertPublicUrl("http://192.168.1.1/")).toThrow(/private IP/i);
    });

    it("should block IPv6 loopback, ULA, link-local, and IPv4-mapped addresses", () => {
      expect(isBlockedIpv6("::1")).toBe(true);
      expect(isBlockedIpv6("[::1]")).toBe(true);
      expect(isBlockedIpv6("0:0:0:0:0:0:0:1")).toBe(true);
      expect(isBlockedIpv6("fc00::1")).toBe(true);
      expect(isBlockedIpv6("fe80::1")).toBe(true);
      expect(isBlockedIpv6("::ffff:127.0.0.1")).toBe(true);
      expect(isBlockedIpv6("::ffff:7f00:1")).toBe(true);
      expect(isBlockedIpv6("::ffff:169.254.169.254")).toBe(true);

      expect(() => assertPublicUrl("http://[::1]/")).toThrow(/private IP/i);
      expect(() => assertPublicUrl("http://[::ffff:127.0.0.1]/")).toThrow(/private IP/i);
      expect(() => assertPublicUrl("http://[fe80::1]/")).toThrow(/private IP/i);
    });

    it("should block DNS rebinding and loopback domain services", () => {
      expect(() => assertPublicUrl("http://127.0.0.1.nip.io/")).toThrow(/internal host/i);
      expect(() => assertPublicUrl("http://localtest.me/")).toThrow(/internal host/i);
      expect(() => assertPublicUrl("http://app.internal/")).toThrow(/internal host/i);
    });

    it("should reject non-HTTP/HTTPS protocol schemes", () => {
      expect(() => assertPublicUrl("file:///etc/passwd")).toThrow(/unsupported protocol/i);
      expect(() => assertPublicUrl("gopher://127.0.0.1:6379/_")).toThrow(/unsupported protocol/i);
    });

    it("should allow valid public HTTP/HTTPS URLs", () => {
      expect(() => assertPublicUrl("https://api.openai.com/v1/chat/completions")).not.toThrow();
      expect(() => assertPublicUrl("https://api.anthropic.com/v1/messages")).not.toThrow();
    });
  });

  describe("At-Rest Symmetric Encryption (AES-256-GCM) (OWASP ASVS 14.1.1 / 11.2.1)", () => {
    it("should encrypt and decrypt secrets cleanly with authentication tag", () => {
      const secret = "sk-ant-api03-very-secret-key-123456789";
      const encrypted = encryptSecret(secret);

      expect(encrypted).not.toBe(secret);
      expect(encrypted.startsWith("enc:v1:")).toBe(true);

      const decrypted = decryptSecret(encrypted);
      expect(decrypted).toBe(secret);
    });

    it("should return plaintext transparently if not encrypted for backward compatibility", () => {
      const legacyPlaintext = "sk-plain-text-legacy-key";
      expect(decryptSecret(legacyPlaintext)).toBe(legacyPlaintext);
    });

    it("should securely encrypt connection credentials in database repository", async () => {
      const created = await createProviderConnection({
        provider: "openai",
        authType: "apikey",
        name: "Security Encrypted Test Provider",
        apiKey: "sk-proj-super-secret-key-999",
        isActive: true,
      });

      expect(created.id).toBeDefined();

      const connections = await getProviderConnections({ provider: "openai" });
      const found = connections.find((c) => c.id === created.id);
      expect(found).toBeDefined();
      expect(found?.apiKey).toBe("sk-proj-super-secret-key-999");

      // Cleanup
      await deleteProviderConnection(created.id);
    });
  });

  describe("Sensitive Credential Sanitization in Observability (OWASP ASVS 16.1.2)", () => {
    it("should sanitize Authorization and API keys in headers", () => {
      const sensitiveHeaders = {
        authorization: "Bearer user-token-secret-123",
        Authorization: "Bearer sk-upstream-secret-key-456",
        "x-api-key": "sk-secret-upstream-789",
        "content-type": "application/json",
        cookie: "auth_token=secret-jwt",
      };

      const sanitized = reqDetailsTest.sanitizeHeaders(sensitiveHeaders);
      expect(sanitized["content-type"]).toBe("application/json");
      expect(sanitized.authorization).toBeUndefined();
      expect(sanitized.Authorization).toBeUndefined();
      expect(sanitized["x-api-key"]).toBeUndefined();
      expect(sanitized.cookie).toBeUndefined();
    });
  });
});

