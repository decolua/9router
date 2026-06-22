import { describe, it, expect } from "vitest";
import { validateUrl, assertPublicUrl } from "../../src/shared/utils/ssrfGuard.js";

describe("ssrfGuard - strict mode (default)", () => {
  describe("blocks loopback addresses", () => {
    it("blocks localhost", () => {
      const r = validateUrl("http://localhost:8080");
      expect(r.ok).toBe(false);
      expect(r.error).toContain("loopback not allowed");
    });

    it("blocks 127.0.0.1", () => {
      const r = validateUrl("http://127.0.0.1:8080");
      expect(r.ok).toBe(false);
      expect(r.error).toContain("loopback not allowed");
    });

    it("blocks 127.0.0.2", () => {
      const r = validateUrl("http://127.0.0.2:8080");
      expect(r.ok).toBe(false);
      expect(r.error).toContain("loopback not allowed");
    });

    it("blocks ::1 (IPv6 loopback)", () => {
      const r = validateUrl("http://[::1]:8080");
      expect(r.ok).toBe(false);
      expect(r.error).toContain("loopback not allowed");
    });
  });

  describe("blocks cloud metadata endpoints", () => {
    it("blocks 169.254.169.254 (AWS/GCP/Azure metadata)", () => {
      const r = validateUrl("http://169.254.169.254/latest/meta-data/");
      expect(r.ok).toBe(false);
      expect(r.error).toContain("cloud metadata endpoint");
    });

    it("blocks fd00:ec2::254 (AWS IPv6 metadata)", () => {
      const r = validateUrl("http://[fd00:ec2::254]/latest/meta-data/");
      expect(r.ok).toBe(false);
      expect(r.error).toContain("cloud metadata endpoint");
    });
  });

  describe("blocks private IP ranges", () => {
    it("blocks 10.0.0.1 (RFC-1918 class A)", () => {
      const r = validateUrl("http://10.0.0.1:8080");
      expect(r.ok).toBe(false);
      expect(r.error).toContain("private IP");
    });

    it("blocks 172.16.0.1 (RFC-1918 class B)", () => {
      const r = validateUrl("http://172.16.0.1:8080");
      expect(r.ok).toBe(false);
      expect(r.error).toContain("private IP");
    });

    it("blocks 192.168.1.1 (RFC-1918 class C)", () => {
      const r = validateUrl("http://192.168.1.1:8080");
      expect(r.ok).toBe(false);
      expect(r.error).toContain("private IP");
    });

    it("blocks 169.254.1.1 (link-local)", () => {
      const r = validateUrl("http://169.254.1.1:8080");
      expect(r.ok).toBe(false);
      expect(r.error).toContain("private IP");
    });

    it("blocks fe80:: (IPv6 link-local)", () => {
      const r = validateUrl("http://[fe80::1]:8080");
      expect(r.ok).toBe(false);
      expect(r.error).toContain("private IP");
    });

    it("blocks fc00:: (IPv6 ULA)", () => {
      const r = validateUrl("http://[fc00::1]:8080");
      expect(r.ok).toBe(false);
      expect(r.error).toContain("private IP");
    });

    it("blocks fd00:: (IPv6 ULA)", () => {
      const r = validateUrl("http://[fd00::1]:8080");
      expect(r.ok).toBe(false);
      expect(r.error).toContain("private IP");
    });
  });

  describe("blocks internal hostnames", () => {
    it("blocks .internal suffix", () => {
      const r = validateUrl("http://service.internal:8080");
      expect(r.ok).toBe(false);
      expect(r.error).toContain("internal host");
    });

    it("blocks .local suffix", () => {
      const r = validateUrl("http://myserver.local:8080");
      expect(r.ok).toBe(false);
      expect(r.error).toContain("internal host");
    });

    it("blocks .localhost suffix", () => {
      const r = validateUrl("http://app.localhost:8080");
      expect(r.ok).toBe(false);
      expect(r.error).toContain("internal host");
    });
  });

  describe("blocks unsafe schemes", () => {
    it("blocks file:// scheme", () => {
      const r = validateUrl("file:///etc/passwd");
      expect(r.ok).toBe(false);
      expect(r.error).toContain("not allowed");
    });

    it("blocks gopher:// scheme", () => {
      const r = validateUrl("gopher://localhost:70/");
      expect(r.ok).toBe(false);
      expect(r.error).toContain("not allowed");
    });

    it("blocks ftp:// scheme", () => {
      const r = validateUrl("ftp://example.com/file.txt");
      expect(r.ok).toBe(false);
      expect(r.error).toContain("not allowed");
    });
  });

  describe("allows public URLs", () => {
    it("allows public HTTP URL", () => {
      const r = validateUrl("http://example.com/api");
      expect(r.ok).toBe(true);
      expect(r.url).toBeDefined();
      expect(r.url.hostname).toBe("example.com");
    });

    it("allows public HTTPS URL", () => {
      const r = validateUrl("https://api.example.com/v1/data");
      expect(r.ok).toBe(true);
      expect(r.url).toBeDefined();
    });

    it("allows public IP (8.8.8.8)", () => {
      const r = validateUrl("http://8.8.8.8:80");
      expect(r.ok).toBe(true);
    });
  });

  describe("validates input", () => {
    it("rejects empty string", () => {
      const r = validateUrl("");
      expect(r.ok).toBe(false);
      expect(r.error).toContain("URL required");
    });

    it("rejects null", () => {
      const r = validateUrl(null);
      expect(r.ok).toBe(false);
      expect(r.error).toContain("URL required");
    });

    it("rejects undefined", () => {
      const r = validateUrl(undefined);
      expect(r.ok).toBe(false);
      expect(r.error).toContain("URL required");
    });

    it("rejects invalid URL", () => {
      const r = validateUrl("not-a-url");
      expect(r.ok).toBe(false);
      expect(r.error).toContain("Invalid URL");
    });
  });
});

describe("ssrfGuard - loopback-allowed mode", () => {
  describe("allows loopback addresses", () => {
    it("allows localhost", () => {
      const r = validateUrl("http://localhost:8787", { allowLoopback: true });
      expect(r.ok).toBe(true);
      expect(r.url.hostname).toBe("localhost");
    });

    it("allows 127.0.0.1", () => {
      const r = validateUrl("http://127.0.0.1:8787", { allowLoopback: true });
      expect(r.ok).toBe(true);
      expect(r.url.hostname).toBe("127.0.0.1");
    });

    it("allows 127.0.0.2", () => {
      const r = validateUrl("http://127.0.0.2:8787", { allowLoopback: true });
      expect(r.ok).toBe(true);
    });

    it("allows ::1 (IPv6 loopback)", () => {
      const r = validateUrl("http://[::1]:8787", { allowLoopback: true });
      expect(r.ok).toBe(true);
      expect(r.url.hostname).toBe("[::1]");  // URL.hostname includes brackets
    });
  });

  describe("still blocks cloud metadata", () => {
    it("blocks 169.254.169.254 even with allowLoopback", () => {
      const r = validateUrl("http://169.254.169.254/", { allowLoopback: true });
      expect(r.ok).toBe(false);
      expect(r.error).toContain("cloud metadata endpoint");
    });

    it("blocks AWS IPv6 metadata even with allowLoopback", () => {
      const r = validateUrl("http://[fd00:ec2::254]/", { allowLoopback: true });
      expect(r.ok).toBe(false);
      expect(r.error).toContain("cloud metadata endpoint");
    });
  });

  describe("still blocks private IPs", () => {
    it("blocks 192.168.1.1 even with allowLoopback", () => {
      const r = validateUrl("http://192.168.1.1:8080", { allowLoopback: true });
      expect(r.ok).toBe(false);
      expect(r.error).toContain("private IP");
    });

    it("blocks 10.0.0.1 even with allowLoopback", () => {
      const r = validateUrl("http://10.0.0.1:8080", { allowLoopback: true });
      expect(r.ok).toBe(false);
      expect(r.error).toContain("private IP");
    });

    it("blocks 172.16.0.1 even with allowLoopback", () => {
      const r = validateUrl("http://172.16.0.1:8080", { allowLoopback: true });
      expect(r.ok).toBe(false);
      expect(r.error).toContain("private IP");
    });
  });

  describe("still blocks internal hostnames", () => {
    it("blocks .internal suffix even with allowLoopback", () => {
      const r = validateUrl("http://service.internal", { allowLoopback: true });
      expect(r.ok).toBe(false);
      expect(r.error).toContain("internal host");
    });
  });

  describe("allows public URLs", () => {
    it("allows public HTTP URL with allowLoopback", () => {
      const r = validateUrl("http://example.com/api", { allowLoopback: true });
      expect(r.ok).toBe(true);
    });
  });
});

describe("ssrfGuard - loopback-only mode", () => {
  describe("allows only loopback addresses", () => {
    it("allows localhost", () => {
      const r = validateUrl("http://localhost:8787", { loopbackOnly: true });
      expect(r.ok).toBe(true);
      expect(r.url.hostname).toBe("localhost");
    });

    it("allows 127.0.0.1", () => {
      const r = validateUrl("http://127.0.0.1:8787", { loopbackOnly: true });
      expect(r.ok).toBe(true);
    });

    it("allows ::1", () => {
      const r = validateUrl("http://[::1]:8787", { loopbackOnly: true });
      expect(r.ok).toBe(true);
    });
  });

  describe("blocks everything else", () => {
    it("blocks cloud metadata", () => {
      const r = validateUrl("http://169.254.169.254", { loopbackOnly: true });
      expect(r.ok).toBe(false);
      expect(r.error).toContain("cloud metadata endpoint");
    });

    it("blocks private IPs", () => {
      const r = validateUrl("http://192.168.1.1", { loopbackOnly: true });
      expect(r.ok).toBe(false);
      expect(r.error).toContain("private IP");
    });

    it("blocks public IPs", () => {
      const r = validateUrl("http://8.8.8.8", { loopbackOnly: true });
      expect(r.ok).toBe(false);
      expect(r.error).toContain("only loopback addresses allowed");
    });

    it("blocks public hostnames", () => {
      const r = validateUrl("http://example.com", { loopbackOnly: true });
      expect(r.ok).toBe(false);
      expect(r.error).toContain("only loopback addresses allowed");
    });

    it("blocks internal suffixes", () => {
      const r = validateUrl("http://service.internal", { loopbackOnly: true });
      expect(r.ok).toBe(false);
      expect(r.error).toContain("internal host");
    });
  });
});

describe("assertPublicUrl wrapper", () => {
  it("throws on blocked URL in strict mode", () => {
    expect(() => assertPublicUrl("http://localhost:8080")).toThrow("loopback not allowed");
  });

  it("throws on cloud metadata", () => {
    expect(() => assertPublicUrl("http://169.254.169.254")).toThrow("cloud metadata endpoint");
  });

  it("does not throw on public URL", () => {
    const url = assertPublicUrl("https://example.com");
    expect(url).toBeDefined();
    expect(url.hostname).toBe("example.com");
  });

  it("allows loopback when option is set", () => {
    const url = assertPublicUrl("http://localhost:8787", { allowLoopback: true });
    expect(url).toBeDefined();
    expect(url.hostname).toBe("localhost");
  });

  it("blocks private IP even with allowLoopback", () => {
    expect(() =>
      assertPublicUrl("http://192.168.1.1", { allowLoopback: true })
    ).toThrow("private IP");
  });
});
