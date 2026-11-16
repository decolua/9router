/**
 * Where two Messages request bodies stop sharing a prefix, and where each put
 * its cache breakpoint.
 *
 *   node scripts/fork/lib/diff-prompt-prefix.mjs <earlier.json> <later.json>
 *
 * The prompt cache reads back a prefix only if the later request repeats it
 * byte for byte up to a breakpoint the earlier one wrote. So the questions are
 * exactly two: where does the later request first differ, and was the earlier
 * breakpoint before that point. Everything here answers those and nothing
 * else — block text is summarised by length and hash, never printed, because a
 * captured body is somebody's conversation.
 */
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hash = (value) => crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);

const withoutCacheControl = (block) => {
  if (!block || typeof block !== "object") return block;
  const { cache_control: _ignored, ...rest } = block;
  return rest;
};

/**
 * Every cacheable unit of a request, in prompt order: tools, then system
 * blocks, then message content blocks — the order the API builds the prefix in.
 */
export function prefixBlocks(body) {
  const out = [];
  const push = (where, block) => {
    const plain = JSON.stringify(withoutCacheControl(block));
    out.push({
      where,
      type: typeof block === "string" ? "string" : block?.type || "unknown",
      chars: plain.length,
      hash: hash(plain),
      cached: Boolean(block && typeof block === "object" && block.cache_control),
    });
  };
  (Array.isArray(body?.tools) ? body.tools : []).forEach((tool, i) => push(`tools[${i}]`, tool));
  if (typeof body?.system === "string") push("system", { type: "text", text: body.system });
  else (Array.isArray(body?.system) ? body.system : []).forEach((block, i) => push(`system[${i}]`, block));
  (Array.isArray(body?.messages) ? body.messages : []).forEach((message, i) => {
    const content = typeof message?.content === "string"
      ? [{ type: "text", text: message.content }]
      : (Array.isArray(message?.content) ? message.content : []);
    content.forEach((block, j) => push(`messages[${i}].${message?.role}[${j}]`, block));
  });
  return out;
}

/**
 * @returns {{
 *   firstDifference: number|null, // index into the later request's blocks, null if it extends the earlier one
 *   earlierBreakpoints: number[], laterBreakpoints: number[],
 *   earlierBreakpointReused: boolean, // the earlier request's last breakpoint lies inside the shared prefix
 *   earlier: object[], later: object[],
 * }}
 */
export function diffPrefix(earlierBody, laterBody) {
  const earlier = prefixBlocks(earlierBody);
  const later = prefixBlocks(laterBody);
  let firstDifference = null;
  for (let k = 0; k < Math.min(earlier.length, later.length); k += 1) {
    if (earlier[k].hash !== later[k].hash) { firstDifference = k; break; }
  }
  if (firstDifference === null && later.length < earlier.length) firstDifference = later.length;
  const earlierBreakpoints = earlier.map((b, k) => (b.cached ? k : -1)).filter((k) => k >= 0);
  const laterBreakpoints = later.map((b, k) => (b.cached ? k : -1)).filter((k) => k >= 0);
  const shared = firstDifference === null ? earlier.length : firstDifference;
  const lastEarlier = earlierBreakpoints.length ? earlierBreakpoints[earlierBreakpoints.length - 1] : -1;
  return {
    firstDifference,
    earlierBreakpoints,
    laterBreakpoints,
    earlierBreakpointReused: lastEarlier >= 0 && lastEarlier < shared,
    earlier,
    later,
  };
}

export function formatDiff(result) {
  const lines = [];
  const row = (label, b, k) => `${label} #${k} ${b.where} ${b.type} ${b.chars}c ${b.hash}${b.cached ? " [cache_control]" : ""}`;
  const shared = result.firstDifference === null ? result.earlier.length : result.firstDifference;
  lines.push(`shared prefix: ${shared} block(s); earlier has ${result.earlier.length}, later has ${result.later.length}`);
  lines.push(`earlier breakpoints: ${result.earlierBreakpoints.join(", ") || "none"}; later: ${result.laterBreakpoints.join(", ") || "none"}`);
  lines.push(`earlier breakpoint inside shared prefix (cache can hit): ${result.earlierBreakpointReused}`);
  if (result.firstDifference !== null) {
    const k = result.firstDifference;
    if (result.earlier[k]) lines.push(`  differs at ${row("earlier", result.earlier[k], k)}`);
    if (result.later[k]) lines.push(`           ${row("later  ", result.later[k], k)}`);
  }
  return lines.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [a, b] = process.argv.slice(2);
  if (!a || !b) {
    console.error("usage: diff-prompt-prefix.mjs <earlier.json> <later.json>");
    process.exit(2);
  }
  const result = diffPrefix(JSON.parse(fs.readFileSync(a, "utf8")), JSON.parse(fs.readFileSync(b, "utf8")));
  console.log(formatDiff(result));
  if (process.argv.includes("--all")) {
    result.later.forEach((block, k) => console.log(`  later #${k} ${block.where} ${block.type} ${block.chars}c ${block.hash}${block.cached ? " [cache_control]" : ""}`));
  }
}
