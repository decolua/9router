import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const iconPath = (id) => join(repoRoot, "public", "providers", `${id}.png`);

// Generic self-host slots, not brands: their own registry comments list several
// interchangeable servers (llama.cpp / vLLM / Infinity / TEI, whisper.cpp /
// faster-whisper / Speaches, Kokoro-FastAPI / openedai-speech). llama.cpp and
// whisper.cpp are both ggml-org, so that avatar would render Embedding and STT
// identically — worse than the distinct SE / ST badges. They keep the badge.
const NO_BRAND_MARK = ["selfhosted-embedding", "selfhosted-stt", "selfhosted-tts"];

const ADDED = ["fish-audio", "alims-intl", "alitp-intl"];
const ALIBABA_BRAND = ["alicode-intl", "alims-intl", "alitp-intl"];
const BRAND_SOURCE = "alicode";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readPngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("provider brand icons", () => {
  it("ships an icon for every provider except the generic self-host slots", async () => {
    const registry = (await import("../../open-sse/providers/registry/index.js")).default;
    const { getProviderIconSrc } = await import("../../src/shared/utils/providerIcon.js");

    const missing = registry
      .map((p) => p.id)
      .filter((id) => {
        const src = getProviderIconSrc(id);
        return !src || !existsSync(join(repoRoot, "public", src));
      });

    expect(missing.sort()).toEqual([...NO_BRAND_MARK].sort());
  });

  it("resolves the added providers to the convention path", async () => {
    const { getProviderIconSrc } = await import("../../src/shared/utils/providerIcon.js");
    for (const id of ADDED) {
      expect(getProviderIconSrc(id)).toBe(`/providers/${id}.png`);
      expect(existsSync(iconPath(id)), `${id}.png missing`).toBe(true);
    }
  });

  it("matches the 128x128 PNG shape the folder already uses", () => {
    for (const id of ADDED) {
      const buf = readFileSync(iconPath(id));
      expect(buf.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
      expect(readPngSize(buf)).toEqual({ width: 128, height: 128 });
    }
  });

  it("reuses the one Alibaba Cloud mark rather than a lookalike", () => {
    const source = readFileSync(iconPath(BRAND_SOURCE));
    for (const id of ALIBABA_BRAND) {
      expect(readFileSync(iconPath(id)).equals(source), `${id}.png differs from ${BRAND_SOURCE}.png`).toBe(true);
    }
    expect(readFileSync(iconPath("fish-audio")).equals(source)).toBe(false);
  });

  it("keeps the text badge as the 404 fallback", async () => {
    const entries = await Promise.all(
      ADDED.map((id) => import(`../../open-sse/providers/registry/${id}.js`).then((m) => [id, m.default])),
    );
    const badges = Object.fromEntries(entries.map(([id, p]) => [id, p.display.textIcon]));
    expect(badges).toEqual({ "fish-audio": "FA", "alims-intl": "ALi", "alitp-intl": "ATP" });

    const colors = Object.fromEntries(entries.map(([id, p]) => [id, p.display.color]));
    expect(colors["alims-intl"]).toBe("#FF6A00");
    expect(colors["alitp-intl"]).toBe("#FF6A00");
  });
});
