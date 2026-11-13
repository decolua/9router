#!/usr/bin/env node
// Claude Code status line: shows the 9Router key's budgets from GET /v1/limits.
//
// ~/.claude/settings.json:
//   "statusLine": { "type": "command", "command": "node /path/to/9router/scripts/claude-statusline.mjs" }
//
// Uses the same env Claude Code talks to 9Router with: ANTHROPIC_BASE_URL and
// ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY (NINEROUTER_URL / NINEROUTER_KEY override).
// Prints e.g. "9R 5h $1.20/$5 · Week ⚠ $21.00/$25 · resets 14:32"
const base = (process.env.NINEROUTER_URL || process.env.ANTHROPIC_BASE_URL || "http://localhost:20128").replace(/\/+$/, "").replace(/\/v1$/, "");
const key = process.env.NINEROUTER_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;

const usd = (n) => `$${n.toFixed(n >= 100 ? 0 : 2)}`;
const time = (iso) => {
  const d = new Date(iso);
  return d - Date.now() < 86400000 ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric" });
};
const SHORT = { "5h": "5h", week: "Week", month: "Month" };

try {
  const res = await fetch(`${base}/v1/limits`, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    signal: AbortSignal.timeout(1500),
  });
  if (!res.ok) throw new Error(String(res.status));
  const s = await res.json();
  if (s.expired) {
    console.log("9R ⛔ key expired");
  } else {
    const set = s.limits.filter((l) => l.limit_usd !== null);
    const parts = set.map((l) => {
      const mark = l.blocked ? "⛔ " : l.utilization >= 0.8 ? "⚠ " : "";
      return `${SHORT[l.period] || l.period} ${mark}${usd(l.used_usd)}/${usd(l.limit_usd)}`;
    });
    // Show when the tightest budget frees up.
    const tightest = [...set].sort((a, b) => b.utilization - a.utilization)[0];
    if (tightest?.used_usd > 0 && tightest.resets_at) parts.push(`resets ${time(tightest.resets_at)}`);
    console.log(parts.length ? `9R ${parts.join(" · ")}` : "9R no limits");
  }
} catch {
  console.log("9R limits n/a");
}
