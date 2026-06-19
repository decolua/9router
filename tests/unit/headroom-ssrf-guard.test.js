import { describe, it, expect } from "vitest";
import { validateProbeUrl } from "../../src/lib/headroom/probeGuard.js";

describe("headroom probe SSRF guard", () => {
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

  it("rejects external host", () => {
    const r = validateProbeUrl("http://169.254.169.254/latest/meta-data/");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("loopback-only");
  });

  it("rejects RFC-1918 private range 192.168.x", () => {
    expect(validateProbeUrl("http://192.168.1.1:8787").ok).toBe(false);
  });

  it("rejects RFC-1918 private range 10.x", () => {
    expect(validateProbeUrl("http://10.0.0.1:8787").ok).toBe(false);
  });

  it("rejects cloud metadata endpoint", () => {
    expect(validateProbeUrl("http://169.254.169.254").ok).toBe(false);
  });

  it("rejects non-http scheme file://", () => {
    expect(validateProbeUrl("file:///etc/passwd").ok).toBe(false);
  });

  it("rejects non-http scheme gopher://", () => {
    expect(validateProbeUrl("gopher://localhost:6379/").ok).toBe(false);
  });

  it("rejects invalid URL string", () => {
    expect(validateProbeUrl("not-a-url").ok).toBe(false);
  });

  it("rejects empty string", () => {
    expect(validateProbeUrl("").ok).toBe(false);
  });

  it("rejects null", () => {
    expect(validateProbeUrl(null).ok).toBe(false);
  });

  it("rejects undefined", () => {
    expect(validateProbeUrl(undefined).ok).toBe(false);
  });
});
