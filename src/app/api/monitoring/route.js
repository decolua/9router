import { NextResponse } from "next/server";
import fs from "node:fs";
import { APP_CONFIG } from "@/shared/constants/config";
import { getDataDir } from "@/lib/dataDir";
import { DATA_FILE } from "@/lib/db/paths";
import { getUsageStats, getActiveRequests, getRecentLogs } from "@/lib/db/index.js";

export const dynamic = "force-dynamic";

/**
 * GET /api/monitoring
 *
 * Satu panggilan untuk kebutuhan halaman Monitoring: status runtime,
 * ringkasan aktivitas, dan kesehatan per-provider. Semua angka berasal
 * dari sumber yang sudah ada (DB usage + filesystem), tidak ada data baru
 * yang disimpan.
 */
export async function GET() {
  const startedAt = Date.now();

  const [runtime, activity, health] = await Promise.all([
    collectRuntime(),
    collectActivity(),
    collectProviderHealth(),
  ]);

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    latencyMs: Date.now() - startedAt,
    version: APP_CONFIG?.version || "unknown",
    runtime,
    activity,
    health,
  });
}

/** Status runtime: berkas DB, data dir, dan request yang sedang jalan. */
async function collectRuntime() {
  const out = {
    dataDir: "",
    dbPath: "",
    dbSizeBytes: 0,
    dbSizeLabel: "-",
    activeRequests: 0,
    activeDetail: [],
    pending: 0,
    processUptimeSec: Math.round(process.uptime()),
    memoryRssMB: 0,
    nodeVersion: process.version,
  };

  try {
    out.processUptimeSec = Math.round(process.uptime());
    out.memoryRssMB = Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(1));
  } catch { /* process metrics unavailable */ }

  try {
    out.dataDir = getDataDir();
    out.dbPath = DATA_FILE;
    out.dbSizeBytes = fs.statSync(DATA_FILE).size;
    out.dbSizeLabel = formatBytes(out.dbSizeBytes);
  } catch { /* db file may not exist yet */ }

  try {
    const active = await getActiveRequests();
    const list = Array.isArray(active) ? active : [];
    out.activeDetail = list.map((a) => ({
      model: a.model || "",
      provider: a.provider || "",
      account: a.account || "",
      count: a.count || 0,
    }));
    out.activeRequests = out.activeDetail.reduce((s, a) => s + a.count, 0);
  } catch { /* no active requests */ }

  return out;
}

/** Ringkasan aktivitas dari statistik usage. */
async function collectActivity() {
  const out = {
    today: null,
    successRate: null,
    errorProvider: "",
    recent: [],
  };

  try {
    const stats = await getUsageStats("24h");
    if (stats) {
      out.today = {
        requests: stats.totalRequests || 0,
        promptTokens: stats.totalPromptTokens || 0,
        completionTokens: stats.totalCompletionTokens || 0,
        cachedTokens: stats.totalCachedTokens || 0,
        cost: stats.totalCost || 0,
        providers: Object.keys(stats.byProvider || {}).length,
        models: Object.keys(stats.byModel || {}).length,
      };

      // Hitung success rate dari daftar provider bila tersedia.
      const byProvider = Object.values(stats.byProvider || {});
      let errs = 0;
      let total = 0;
      for (const p of byProvider) {
        errs += Number(p.errors || p.failed || 0);
        total += Number(p.requests || p.count || 0);
      }
      if (total > 0) {
        out.successRate = Number((((total - errs) / total) * 100).toFixed(1));
      }
      out.errorProvider = stats.errorProvider || "";
    }
  } catch { /* stats unavailable */ }

  try {
    // getRecentLogs mengembalikan string pra-format, bukan objek:
    //   "dd-mm-yyyy HH:MM:SS | model | PROVIDER | akun | prompt | completion | status"
    const logs = await getRecentLogs(20);
    out.recent = (Array.isArray(logs) ? logs : []).slice(0, 20).map(parseLogLine);
  } catch { /* logs unavailable */ }

  return out;
}

/** parseLogLine mengubah baris log 9Router menjadi objek untuk UI. */
function parseLogLine(line) {
  if (typeof line !== "string") return { raw: String(line ?? "") };
  const parts = line.split("|").map((s) => s.trim());
  if (parts.length < 7) return { raw: line };
  return {
    timestamp: parts[0],
    model: parts[1],
    provider: parts[2],
    account: parts[3],
    promptTokens: parts[4],
    completionTokens: parts[5],
    status: parts[6],
    raw: line,
  };
}

/** Kesehatan per-provider: berapa request, berapa error, kapan terakhir. */
async function collectProviderHealth() {
  const providers = [];

  try {
    const stats = await getUsageStats("7d");
    const byProvider = stats?.byProvider || {};

    // Error & waktu terakhir TIDAK tersedia di byProvider; ambil dari
    // tabel usageHistory langsung supaya angkanya nyata.
    const { errors: errMap, lastUsed: lastMap } = await errorCountByProvider();

    for (const [id, data] of Object.entries(byProvider)) {
      const requests = Number(data?.requests ?? 0);
      const errors = errMap[id] || 0;
      providers.push({
        id,
        name: data?.name || id,
        requests,
        errors,
        successRate:
          requests > 0
            ? Number((((requests - errors) / requests) * 100).toFixed(1))
            : null,
        lastUsed: lastMap[id] || "",
        cost: Number(data?.cost || 0),
      });
    }
  } catch { /* stats unavailable */ }

  providers.sort((a, b) => b.requests - a.requests);
  return providers.slice(0, 50);
}

/**
 * errorCountByProvider menghitung request gagal per provider dari
 * usageHistory. Status dianggap sukses bila kosong/"ok"/"success";
 * selain itu dihitung sebagai error.
 */
async function errorCountByProvider() {
  const { errors, lastUsed } = await providerActivityIndex();
  return { errors, lastUsed };
}

/**
 * providerActivityIndex menghitung, per provider, jumlah error dan waktu
 * pemakaian terakhir dari tabel usageHistory.
 */
async function providerActivityIndex() {
  const errors = {};
  const lastUsed = {};
  try {
    const { getUsageHistory } = await import("@/lib/db/index.js");
    const rows = await getUsageHistory({});
    for (const r of Array.isArray(rows) ? rows : []) {
      const id = r.provider || "";
      const s = String(r.status || "ok").toLowerCase();
      const ok = s === "ok" || s === "success" || s === "200" || s === "";
      if (!ok) errors[id] = (errors[id] || 0) + 1;

      const t = r.timestamp || "";
      if (t && (!lastUsed[id] || String(t) > String(lastUsed[id]))) {
        lastUsed[id] = t;
      }
    }
  } catch { /* tabel tidak tersedia */ }
  return { errors, lastUsed };
}

function formatBytes(bytes) {
  if (!bytes || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function truncate(s, n) {
  if (typeof s !== "string") return "";
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}
