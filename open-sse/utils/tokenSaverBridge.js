import { detectFormat } from "../services/provider.js";
import { createNonStreamingResponse, createStreamingResponse } from "./bypassResponse.js";

const DEFAULT_PONYTAIL_HELP =
  "Ponytail — lazy-senior persona for minimal code.\n" +
  "\n" +
  "3 intensity levels:\n" +
  "  lite   — name the lazier alternative in one line; user picks\n" +
  "  full   — ladder enforced; stdlib and native first\n" +
  "  ultra  — YAGNI extremist; ship the one-liner, challenge the rest\n" +
  "\n" +
  "7-rung ladder (stop at the first rung that holds):\n" +
  "  1. Does this need to exist at all? (YAGNI)\n" +
  "  2. Does the codebase already solve it? Reuse patterns.\n" +
  "  3. Stdlib does it? Use it.\n" +
  "  4. Native platform feature covers it? Use it (CSS over JS, DB over app).\n" +
  "  5. Already-installed dependency solves it? Use it.\n" +
  "  6. Can it be one line? One line.\n" +
  "  7. Only then: the minimum code that works.\n" +
  "\n" +
  "Rules: no unrequested abstractions. No boilerplate \"for later\". " +
  "Deletion over addition. Boring over clever. Shortest working diff wins.\n" +
  "\n" +
  "Output: code first. Then at most three short lines: what was skipped, " +
  "when to add it. Pattern: `[code] -> skipped: [X], add when [Y].`\n" +
  "\n" +
  "How to enable: toggle Ponytail in Token Saver settings.\n" +
  "\n" +
  "Commands:\n" +
  "  /ponytail-gain  — show lifetime usage + cost (stats from local DB)\n" +
  "  /ponytail-help  — show this help text";

function formatGainStats(stats) {
  if (!stats) {
    return "No usage data yet — make a few requests first.";
  }

  const nf = new Intl.NumberFormat("en-US");
  const lines = ["Ponytail gain — lifetime"];
  lines.push("  requests: " + nf.format(stats.totalRequests || 0));
  lines.push("  prompt tokens:     " + nf.format(stats.totalPromptTokens || 0));
  lines.push("  completion tokens: " + nf.format(stats.totalCompletionTokens || 0));
  lines.push("  cached tokens:       " + nf.format(stats.totalCachedTokens || 0));
  lines.push("  est. cost:        $" + (stats.totalCost || 0).toFixed(2));

  if (stats.byProvider && typeof stats.byProvider === "object") {
    const entries = Object.entries(stats.byProvider);
    if (entries.length > 0) {
      let topProvider = entries[0][0];
      let topCount = entries[0][1].requests || 0;
      let totalCount = topCount;
      for (let i = 1; i < entries.length; i++) {
        const count = entries[i][1].requests || 0;
        totalCount += count;
        if (count > topCount) {
          topProvider = entries[i][0];
          topCount = count;
        }
      }
      const pct = totalCount > 0 ? ((topCount / totalCount) * 100).toFixed(0) : "0";
      lines.push("  top provider: " + topProvider + " (" + pct + "% of requests)");
    }
  }

  return lines.join("\n");
}

/**
 * Intercept Ponytail slash commands and return synthetic bypass response.
 * Returns null if no command matched — let request pass through.
 *
 * `fetchStats` is lazy: only invoked when the matched command is
 * `/ponytail-gain`. This keeps the hot path cheap for normal requests.
 */
export async function handlePonytailCommands(body, model, { fetchStats, helpText } = {}) {
  if (!body.messages?.length) return null;

  const getText = (content) => {
    if (typeof content === "string") return content.trim();
    if (Array.isArray(content)) return content.filter(c => c.type === "text").map(c => c.text).join(" ").trim();
    return "";
  };

  const lastUserMsg = [...body.messages].reverse().find(m => m.role === "user");
  if (!lastUserMsg) return null;

  const lastText = getText(lastUserMsg.content);
  if (!lastText) return null;

  const lowerText = lastText.toLowerCase();
  let command = null;

  if (lowerText === "/ponytail-gain" || lowerText === "/ponytail gain") {
    command = "gain";
  } else if (lowerText === "/ponytail-help" || lowerText === "/ponytail help") {
    command = "help";
  }

  if (!command) return null;

  let text;
  if (command === "gain") {
    let stats = null;
    if (typeof fetchStats === "function") {
      try { stats = await fetchStats(); } catch { /* stats are best-effort */ }
    }
    text = formatGainStats(stats);
  } else {
    text = helpText || DEFAULT_PONYTAIL_HELP;
  }

  const sourceFormat = detectFormat(body);
  const stream = body.stream !== false;

  return stream
    ? createStreamingResponse(sourceFormat, model, text)
    : createNonStreamingResponse(sourceFormat, model, text);
}

export { DEFAULT_PONYTAIL_HELP };
