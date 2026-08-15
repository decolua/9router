// ocEgress: OpenCode free-tier egress rotation state (see utils/ocEgress.js).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { applyOcEgress, flipOcEgress, readOcEgress } from "../../open-sse/utils/ocEgress.js";

let tmp;
let file;
let oldAppData;
let oldHome;

beforeEach(() => {
  // Redirect the module's state file into a fresh temp dir per test.
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "oc-egress-test-"));
  file = path.join(tmp, "9router", "oc-egress.json");
  oldAppData = process.env.APPDATA;
  oldHome = process.env.HOME;
  process.env.APPDATA = tmp;
  delete process.env.HOME;
  delete process.env.NO_PROXY;
  delete process.env.no_proxy;
});

afterEach(() => {
  if (oldAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = oldAppData;
  if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

describe("readOcEgress", () => {
  it("defaults to proxy when no state file exists", () => {
    expect(readOcEgress()).toEqual({ mode: "proxy", lastFlipAt: 0, flips: 0 });
  });

  it("rejects unknown modes and normalizes", () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ mode: "banana" }));
    expect(readOcEgress().mode).toBe("proxy");
  });
});

describe("flipOcEgress", () => {
  it("flips proxy -> direct and persists", () => {
    expect(flipOcEgress()).toBe(true);
    const st = readOcEgress();
    expect(st.mode).toBe("direct");
    expect(st.flips).toBe(1);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).mode).toBe("direct");
  });

  it("respects the 60s cooldown", () => {
    expect(flipOcEgress()).toBe(true);
    const before = readOcEgress();
    expect(flipOcEgress()).toBe(false);
    expect(readOcEgress()).toEqual(before);
  });

  it("flips again after cooldown expires", () => {
    // state: direct, last flip long ago -> flipping goes back to proxy
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ mode: "direct", lastFlipAt: Date.now() - 61_000, flips: 1 }));
    expect(flipOcEgress()).toBe(true);
    expect(readOcEgress().mode).toBe("proxy");
    expect(readOcEgress().flips).toBe(2);
  });
});

describe("applyOcEgress", () => {
  it("adds opencode.ai to NO_PROXY in direct mode", () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ mode: "direct", lastFlipAt: 0, flips: 0 }));
    process.env.NO_PROXY = "example.com";
    applyOcEgress();
    expect(process.env.NO_PROXY.split(",")).toContain("opencode.ai");
    expect(process.env.NO_PROXY.split(",")).toContain("example.com");
  });

  it("removes opencode.ai from NO_PROXY in proxy mode and preserves others", () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ mode: "proxy", lastFlipAt: 0, flips: 0 }));
    process.env.NO_PROXY = "opencode.ai,example.com";
    applyOcEgress();
    expect(process.env.NO_PROXY).toBe("example.com");
  });

  it("is a no-op when mode already matches env", () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ mode: "direct", lastFlipAt: 0, flips: 0 }));
    process.env.NO_PROXY = "opencode.ai";
    applyOcEgress();
    expect(process.env.NO_PROXY).toBe("opencode.ai");
  });
});
