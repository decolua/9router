import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import codex from "../../open-sse/providers/registry/codex.js";
const root = new URL("../../", import.meta.url);
it("documents OAuth reuse, ffmpeg limits and does not offer unsupported response formats", () => {
  expect(codex.display.kindNotice.stt).toContain("ffmpeg");
  const page = readFileSync(new URL("src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/page.js", root), "utf8");
  expect(page).toContain('OAUTH_PROVIDERS[id]');
  expect(page).toContain('href={`/dashboard/providers/${id}`}');
  const example = readFileSync(new URL("src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/components/SttExampleCard.js", root), "utf8");
  expect(example).toContain('selectedModelObj?.responseFormats');
  expect(readFileSync(new URL("Dockerfile", root), "utf8").split("AS runner")[1]).toContain("su-exec ffmpeg");
});
