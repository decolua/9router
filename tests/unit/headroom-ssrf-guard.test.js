import { describe, it, expect } from "vitest";
import { validateUrl } from "../../src/shared/utils/ssrfGuard.js";

// Test headroom probe SSRF protection using the shared ssrfGuard with loopbackOnly mode

describe("headroom probe SSRF guard", () => {
  const validateProbeUrl = (url) => validateUrl(url, { loopbackOnly: true });

  it("allows localhost", () => {
    const r = validateProbeUrl("http://localhost:8787");
    expect(r.ok).toBe(true);
  });

  it("allows 127.0.0.1", () => {
    const r = validateProbeUrl("http://127.0.0.1:8787");
    expect(r.ok).toBe(true);
  });

  it("allows ::1 (IPv6 loopback)", () => {
    const r = validateProbeUrl("http://[::1]:8787");
    expect(r.ok).toBe(true);
  });

  it("rejects cloud metadata endpoint", () => {
    const r = validateProbeUrl("http://169.254.169.254/latest/meta-data/");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("cloud metadata endpoint");
  });

  it("rejects RFC-1918 private range 192.168.x", () => {
    const r = validateProbeUrl("http://192.168.1.1:8787");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("private IP");
  });

  it("rejects RFC-1918 private range 10.x", () => {
    const r = validateProbeUrl("http://10.0.0.1:8787");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("private IP");
  });

  it("rejects RFC-1918 private range 172.16.x", () => {
    const r = validateProbeUrl("http://172.16.0.1:8787");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("private IP");
  });

  it("rejects link-local (excludes metadata IP specifically)", () => {
    const r = validateProbeUrl("http://169.254.1.1:8787");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("private IP");
  });

  it("rejects non-http scheme file://", () => {
    const r = validateProbeUrl("file:///etc/passwd");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("not allowed");
  });

  it("rejects non-http scheme gopher://", () => {
    const r = validateProbeUrl("gopher://localhost:6379/");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("not allowed");
  });

  it("rejects invalid URL string", () => {
    const r = validateProbeUrl("not-a-url");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("Invalid URL");
  });

  it("rejects empty string", () => {
    const r = validateProbeUrl("");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("URL required");
  });

  it("rejects null", () => {
    const r = validateProbeUrl(null);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("URL required");
  });

  it("rejects undefined", () => {
    const r = validateProbeUrl(undefined);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("URL required");
  });

  it("rejects public external hosts (loopback-only mode)", () => {
    const r = validateProbeUrl("http://example.com:8787");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("only loopback addresses allowed");
  });

  it("rejects public IP addresses", () => {
    const r = validateProbeUrl("http://8.8.8.8:8787");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("only loopback addresses allowed");
  });
});
