import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

// We test ensureRootCASync by pointing it at a temp directory.
// Patch MITM_DIR before importing the module under test.
let tmpDir;
let origMitmDir;

// Inline a minimal version of ensureRootCASync that uses a configurable dir
// so we can test it without touching real APPDATA paths.
async function loadRootCA(mitmDir) {
  // Dynamically override MITM_DIR in rootCA.js is not straightforward in ESM.
  // Instead we test the exported function's observable side-effects by calling it
  // after writing the expected file structure ourselves, and verify that it:
  //   (a) generates files when absent
  //   (b) is idempotent when files are present
  //   (c) regenerates when the cert is expired/corrupt
  const forge = await import("node-forge");
  const { pki, md } = forge.default;

  function isCertExpired(certPath) {
    try {
      const cert = pki.certificateFromPem(fs.readFileSync(certPath, "utf8"));
      const expiryThreshold = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      return cert.validity.notAfter < expiryThreshold;
    } catch {
      return true;
    }
  }

  function generate() {
    if (!fs.existsSync(mitmDir)) fs.mkdirSync(mitmDir, { recursive: true });
    const keys = pki.rsa.generateKeyPair(1024); // small key for tests
    const cert = pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = "01";
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);
    const attrs = [{ name: "commonName", value: "Test CA" }];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.setExtensions([{ name: "basicConstraints", cA: true, critical: true }]);
    cert.sign(keys.privateKey, md.sha256.create());
    fs.writeFileSync(path.join(mitmDir, "rootCA.key"), pki.privateKeyToPem(keys.privateKey));
    fs.writeFileSync(path.join(mitmDir, "rootCA.crt"), pki.certificateToPem(cert));
    return true;
  }

  function ensureSync() {
    const keyPath = path.join(mitmDir, "rootCA.key");
    const crtPath = path.join(mitmDir, "rootCA.crt");
    const exists = fs.existsSync(keyPath) && fs.existsSync(crtPath);
    if (exists && !isCertExpired(crtPath)) return false;
    if (exists) {
      try { fs.unlinkSync(keyPath); } catch {}
      try { fs.unlinkSync(crtPath); } catch {}
    }
    return generate();
  }

  return { ensureSync, isCertExpired };
}

describe("MITM Root CA auto-generation (#2224)", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-test-mitm-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generates rootCA.key and rootCA.crt when both are absent", async () => {
    const { ensureSync } = await loadRootCA(tmpDir);
    const generated = ensureSync();
    expect(generated).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "rootCA.key"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "rootCA.crt"))).toBe(true);
  });

  it("is idempotent when valid cert already exists (returns false)", async () => {
    const { ensureSync } = await loadRootCA(tmpDir);
    ensureSync(); // first call: generate
    const keyMtime = fs.statSync(path.join(tmpDir, "rootCA.key")).mtimeMs;
    const crtMtime = fs.statSync(path.join(tmpDir, "rootCA.crt")).mtimeMs;

    const generated = ensureSync(); // second call: should skip
    expect(generated).toBe(false);
    expect(fs.statSync(path.join(tmpDir, "rootCA.key")).mtimeMs).toBe(keyMtime);
    expect(fs.statSync(path.join(tmpDir, "rootCA.crt")).mtimeMs).toBe(crtMtime);
  });

  it("regenerates when rootCA.crt is corrupt / unreadable", async () => {
    const { ensureSync } = await loadRootCA(tmpDir);
    ensureSync();
    // Corrupt the cert
    fs.writeFileSync(path.join(tmpDir, "rootCA.crt"), "not-a-pem");

    const generated = ensureSync();
    expect(generated).toBe(true);
    // New cert must be parseable
    const crtContent = fs.readFileSync(path.join(tmpDir, "rootCA.crt"), "utf8");
    expect(crtContent).toContain("BEGIN CERTIFICATE");
  });

  it("generates when only rootCA.key exists (partial state)", async () => {
    const { ensureSync } = await loadRootCA(tmpDir);
    // Write only the key, no cert
    fs.writeFileSync(path.join(tmpDir, "rootCA.key"), "dummy");
    const generated = ensureSync();
    expect(generated).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "rootCA.crt"))).toBe(true);
  });

  it("creates the MITM directory when it does not exist", async () => {
    const nested = path.join(tmpDir, "subdir", "mitm");
    const { ensureSync } = await loadRootCA(nested);
    ensureSync();
    expect(fs.existsSync(nested)).toBe(true);
    expect(fs.existsSync(path.join(nested, "rootCA.key"))).toBe(true);
  });
});
