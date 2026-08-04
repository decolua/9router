import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath) {
  return fs.readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const headroomSource = source("../../src/lib/headroom/detect.js");
const ideDetectSource = source("../../src/lib/oauth/utils/ideDetect.js");
const dnsConfigSource = source("../../src/mitm/dns/dnsConfig.js");
const mitmRouteSource = source("../../src/app/api/cli-tools/antigravity-mitm/route.js");

describe("Windows shell-free status probes", () => {
  it("uses bounded direct commands and cache for Headroom detection", () => {
    expect(headroomSource).not.toMatch(/\bexecSync\s*\(/);
    expect(headroomSource).toContain('execFileSync(WHICH_CMD, ["headroom"], commandOptions())');
    expect(headroomSource).toContain('execFileSync(candidate, ["--version"], commandOptions())');
    expect(headroomSource).toContain("HEADROOM_DETECTION_CACHE_TTL_MS");
    expect(headroomSource).toContain("return readCache(binaryCache");
    expect(headroomSource).toContain("return readCache(pythonCache");
  });

  it("uses direct bounded executable probes for optional IDEs", () => {
    expect(ideDetectSource).not.toMatch(/\bexec\s*\(/);
    expect(ideDetectSource).toContain('os.platform() === "win32" ? "where.exe" : "which"');
    expect(ideDetectSource).toContain("execFile(");
    expect(ideDetectSource).toContain("timeout: IDE_PROBE_TIMEOUT_MS");
  });

  it("does not use cmd.exe to flush DNS during Windows shutdown", () => {
    expect(dnsConfigSource).not.toMatch(/execSync\(\s*["']ipconfig\s+\/flushdns/);
    expect(dnsConfigSource).toContain('execFileSync("ipconfig.exe", ["/flushdns"], {');
    expect(dnsConfigSource).toContain("timeout: WINDOWS_DNS_FLUSH_TIMEOUT_MS");
  });

  it("uses direct bounded fltmc.exe execution for the MITM admin check", () => {
    expect(mitmRouteSource).not.toMatch(/execSync\(\s*["']fltmc/);
    expect(mitmRouteSource).toContain('execFileSync("fltmc.exe", [], {');
    expect(mitmRouteSource).toContain("timeout: ADMIN_CHECK_TIMEOUT_MS");
  });
});
