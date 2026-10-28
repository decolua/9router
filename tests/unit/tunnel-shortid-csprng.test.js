/**
 * The public tunnel subdomain is a capability, not a label.
 *
 * `generateShortId()` produces the `<shortId>` in
 * `https://r<shortId>.abc-tunnel.us`, which is the address the dashboard and the
 * /v1 gateway answer on once a quick tunnel is up. It was drawn with
 * `Math.random()`, which is not a CSPRNG: V8's xorshift128+ state can be recovered
 * from a handful of observed outputs, and every later value from the same process
 * — this id included — is then predictable.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { generateShortId } from "@/lib/tunnel/shared/state.js";

const CHARSET = "abcdefghijklmnpqrstuvwxyz23456789";

describe("tunnel short id", () => {
  it("keeps its length and alphabet", () => {
    for (let i = 0; i < 500; i++) {
      const id = generateShortId();
      expect(id).toHaveLength(6);
      for (const char of id) expect(CHARSET).toContain(char);
    }
  });

  it("keeps excluding the characters that misread aloud", () => {
    // `o`, `0` and `1` are absent from the alphabet on purpose — a tunnel URL gets
    // dictated and typed. (`l` and `i` are present; this pins the actual set.)
    const ids = Array.from({ length: 500 }, generateShortId).join("");
    for (const char of ["o", "0", "1"]) expect(ids).not.toContain(char);
  });

  it("does not repeat itself across a large draw", () => {
    const ids = new Set(Array.from({ length: 5_000 }, generateShortId));
    // 33^6 ≈ 1.29e9 — the birthday bound over 5k draws makes even one collision
    // unlikely (~1%), and a generator stuck in a short cycle would blow past it.
    expect(ids.size).toBeGreaterThan(4_990);
  });

  it("uses the whole alphabet", () => {
    const seen = new Set(Array.from({ length: 3_000 }, generateShortId).join(""));
    // 18k characters over 33 symbols: a symbol never appearing would mean the
    // mapping cannot reach it, not bad luck.
    expect(seen.size).toBe(CHARSET.length);
  });

  it("is drawn from the crypto module, not Math.random", () => {
    const src = fs.readFileSync(
      new URL("../../src/lib/tunnel/shared/state.js", import.meta.url),
      "utf8"
    );
    const body = src.slice(src.indexOf("export function generateShortId"));
    // Comments may name Math.random while explaining why it is not used, so this
    // looks at the function body, not the whole file.
    expect(body).toContain("randomInt(0, SHORT_ID_CHARS.length)");
    expect(/Math\.random\s*\(\)/.test(body)).toBe(false);
    expect(src).toMatch(/from "crypto"|from "node:crypto"/);
  });
});
