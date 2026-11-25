import { statfs, readFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "../dataDir.js";
import { connectionStates } from "../observability/providerHealth.js";
import { requestQuotaSummary } from "../../shared/utils/requestWindows.js";
import { connectionSubject } from "./rules.js";

export async function readProbes({ directory = DATA_DIR, fetcher = fetch, disk = statfs } = {}) {
  const port = Number(process.env.PORT || 20128);
  const [healthy, diskPercent, backup] = await Promise.all([
    (async () => {
      try {
        const response = await fetcher(`http://127.0.0.1:${port}/api/health`, {
          cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000),
        });
        return response.ok && (await response.json()).ok === true;
      } catch { return false; }
    })(),
    disk(directory).then(({ blocks, bavail }) => blocks > 0 ? 100 * (blocks - bavail) / blocks : null).catch(() => null),
    readFile(path.join(directory, "backup-status.json"), "utf8").then(raw => {
      const { status } = JSON.parse(raw);
      return ["ok", "failed"].includes(status) ? status : null;
    }).catch(() => null),
  ]);
  return { healthy, diskPercent, backup };
}

export function readSources(repo, now) {
  const keys = repo.activeKeys(now).map(row => {
    const limits = Object.values(requestQuotaSummary(row, now));
    if (row.budget) {
      const b = repo.budgetBalance(row.id, now);
      limits.push({ used: b.usedTokens + b.heldTokens, limit: b.budget.tokenLimit },
        { used: b.usedMicros + b.heldMicros, limit: b.budget.costLimitMicros });
    }
    return { id: row.id, name: row.name, expiresAt: row.expiresAt, limits };
  });
  const outages = new Map(repo.outages().map(r => [r.target, r.since]));
  const providers = connectionStates(repo.connectionRows(), now).map(({ id, state }) => {
    const subject = connectionSubject(id);
    const target = subject.slice(0, "connection:".length + 18);
    let since = now;
    if (["unavailable", "rate_limited"].includes(state)) {
      since = outages.get(subject) ?? now;
      if (!outages.has(subject)) repo.insertOutage(subject, since);
      outages.delete(subject);
    }
    return { target, subject, state, since };
  });
  for (const target of outages.keys()) repo.deleteOutage(target);
  const usage = repo.recentUsage(now);
  return { keys, providers, ...usage };
}
