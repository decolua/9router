import { NextResponse } from "next/server";
import { spawn, spawnSync } from "child_process";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { getSettings, updateSettings } from "@/lib/localDb.js";
import { getAmmailClientFromSettings } from "@/lib/automation/ammailClient.js";
import { 
  listCodeBuddyAccounts, getCodeBuddyAccount, insertCodeBuddyAccount,
  bulkDeleteCodeBuddyAccounts, deleteCodeBuddyAccount, markCodeBuddyRunning, markCodeBuddySuccess, markCodeBuddyError, markCanvaEnrolled,
  createCodeBuddyJob, getCodeBuddyJob, updateCodeBuddyJobStatus, updateCodeBuddyJobResult,
  createProviderConnection, getProviderConnections, updateProviderConnection,
  deleteProviderConnectionByEmailAndProvider
} from "@/lib/db/index.js";

export const dynamic = "force-dynamic";

function getPythonExecutable() {
  let venvPy = path.resolve(process.cwd(), ".venv/bin/python");
  try {
    if (fs.existsSync(venvPy)) {
      const r = spawnSync(venvPy, ["--version"], { timeout: 2000 });
      if (r.status === 0) return venvPy;
    }
  } catch {}

  let venvPy3 = path.resolve(process.cwd(), ".venv/bin/python3");
  try {
    if (fs.existsSync(venvPy3)) {
      const r = spawnSync(venvPy3, ["--version"], { timeout: 2000 });
      if (r.status === 0) return venvPy3;
    }
  } catch {}

  const homebrewPy = "/opt/homebrew/bin/python3";
  try {
    const r = spawnSync(homebrewPy, ["--version"], { timeout: 2000 });
    if (r.status === 0) return homebrewPy;
  } catch {}

  return "python3";
}

// ── Human-like alias generator ──
const _HUMAN_FIRST_NAMES = [
  "daniel","nisa","alif","rahma","rifki","putri","andi","budi",
  "citra","dewi","eka","fitri","galih","hana","indra","joko",
  "kiki","lina","maya","nanda","okta","putu","rendi","sari",
  "tania","umar","vina","wawan","yusuf","zahra","anggi","bagas",
  "dimas","elis","farah","gita","hadi","iman","jihan","khalid",
  "luna","mira","naufal","olivia","rizki","salsa","tegar","yoga",
  "ayu","rama","lia","yanto","wati","rian","intan","sigit",
  "alex","chris","emma","james","kate","leo","mike","nora",
  "oliver","paula","quinn","ryan","sara","tom","vera","will",
];

function generateHumanAlias() {
  const pick = (arr) => arr[crypto.randomInt(arr.length)];
  const digits = (n) => Array.from({ length: n }, () => crypto.randomInt(10)).join("");
  const first = pick(_HUMAN_FIRST_NAMES);
  const style = crypto.randomInt(4);
  const dLen = 2 + crypto.randomInt(3); // 2-4 digits
  if (style === 0) return `${first}${digits(dLen)}`;
  if (style === 1) return `${first}.${digits(dLen)}`;
  if (style === 2) return `${first}_${digits(dLen)}`;
  let second = pick(_HUMAN_FIRST_NAMES);
  while (second === first) second = pick(_HUMAN_FIRST_NAMES);
  return `${first}.${second}${digits(1 + crypto.randomInt(3))}`;
}

function generateStrongPassword(length = 16) {
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digit = "0123456789";
  const symbol = "!@#$%^&*-_=+";
  const all = lower + upper + digit + symbol;
  const pick = (s) => s[crypto.randomInt(s.length)];
  const chars = [pick(lower), pick(upper), pick(digit), pick(symbol)];
  for (let i = 4; i < length; i++) chars.push(pick(all));
  // Fisher-Yates shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

// Parse proxy string format
function parseProxyString(raw) {
  if (!raw) return null;
  raw = raw.trim();

  const badUrl = raw.match(/^(https?|socks[45]?):\/\/([^:]+):(\d+):([^:]+):(.+)$/);
  if (badUrl) {
    const [, proto, host, port, user, pass] = badUrl;
    return { server: `http://${host}:${port}`, username: user, password: pass };
  }

  const goodUrl = raw.match(/^(socks[45]?|https?|http):\/\/(?:([^:@]+):([^@]+)@)?([^:]+):(\d+)$/);
  if (goodUrl) {
    const [, proto, user, pass, host, port] = goodUrl;
    const r = { server: `${proto}://${host}:${port}` };
    if (user) r.username = user;
    if (pass) r.password = pass;
    return r;
  }

  const parts = raw.split(":");
  if (parts.length === 4 && /^\d+$/.test(parts[1])) {
    return { server: `http://${parts[0]}:${parts[1]}`, username: parts[2], password: parts[3] };
  }

  if (parts.length === 2 && /^\d+$/.test(parts[1])) {
    return { server: `http://${parts[0]}:${parts[1]}` };
  }

  return null;
}

// Global state in memory
if (!global._codebuddyState) {
  global._codebuddyState = {
    activeJobId: null,
    stopFlag: false,
    activeProcesses: new Set(),
    proxyRoundRobinIdx: 0,
  };
} else if (!global._codebuddyState.activeProcesses) {
  global._codebuddyState.activeProcesses = new Set();
}

export async function GET() {
  try {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    let activeJobId = global._codebuddyState.activeJobId || "";

    // Heal dangling running states
    if (!activeJobId) {
      try {
        db.run("UPDATE codebuddyAccounts SET apiKeyStatus = 'failed', lastError = 'Job terhenti atau di-stop.' WHERE apiKeyStatus = 'running'");
        const lastJob = db.get("SELECT * FROM codebuddyJobs ORDER BY createdAt DESC LIMIT 1");
        if (lastJob) {
          let results = [];
          try {
            results = JSON.parse(lastJob.resultsJson || "[]");
          } catch (e) {}
          let modified = false;
          for (const r of results) {
            if (r && r.status === "running") {
              r.status = "failed";
              r.error = "Dihentikan oleh pengguna atau server restart.";
              r.ok = false;
              modified = true;
            }
          }
          const newStatus = lastJob.status === "running" ? "stopped" : lastJob.status;
          if (lastJob.status === "running" || modified) {
            db.run(
              "UPDATE codebuddyJobs SET status = ?, resultsJson = ? WHERE id = ?",
              [newStatus, JSON.stringify(results), lastJob.id]
            );
          }
        }
      } catch (e) {
        console.error("Heal dangling states error:", e);
      }
    }

    const accounts = await listCodeBuddyAccounts();
    const settings = await getSettings();

    let activeJob = null;
    if (activeJobId) {
      const job = await getCodeBuddyJob(activeJobId);
      if (job) {
        activeJob = {
          id: job.id,
          status: job.status,
          count: job.count,
          completed: job.completed || 0,
          success: job.success || 0,
          failed: job.failed || 0,
          progress: job.progress || 0,
          results: job.results || [],
          createdAt: job.createdAt,
        };
      }
    } else {
      try {
        const job = db.get("SELECT * FROM codebuddyJobs WHERE status != 'dismissed' ORDER BY createdAt DESC LIMIT 1");
        if (job) {
          let results = [];
          try {
            results = JSON.parse(job.resultsJson || "[]");
          } catch (e) {}
          activeJob = {
            id: job.id,
            status: job.status,
            count: job.count,
            completed: job.completed || 0,
            success: job.success || 0,
            failed: job.failed || 0,
            progress: job.progress || 0,
            results: results,
            createdAt: job.createdAt,
          };
        }
      } catch (e) {
        console.error("Failed to load last job:", e);
      }
    }

    return NextResponse.json({
      accounts: accounts.map(a => ({
        id: a.id,
        email: a.email,
        api_key: a.apiKey,
        api_key_status: a.apiKeyStatus,
        last_error: a.lastError,
        provider: a.provider || "codebuddy",
      })),
      active_job_id: activeJobId,
      active_job: activeJob,
      settings: {
        auto_9router: settings.codebuddy_auto_9router || "0",
        browser_headless: settings.codebuddy_browser_headless !== "0",
        debug_mode: settings.codebuddy_debug_mode === "1",
        leave_canva_team: settings.codebuddy_leave_canva_team || "0",
        proxy_enabled: settings.codebuddy_proxy_enabled === "1",
        proxy_pool: settings.codebuddy_proxy_pool || "[]",
        leonardo_invite_link: settings.leonardo_invite_link || "",
        codebuddy_2captcha_api_key: settings.codebuddy_2captcha_api_key || "",
      }
    });
  } catch (error) {
    console.error("Error in GET /api/automation/codebuddy:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { action } = body;

    // ── Action: Settings ─────────────────────────────────────────────
    if (action === "settings") {
      const { auto_9router, browser_headless, debug_mode, leave_canva_team, proxy_enabled, proxy_pool, leonardo_invite_link, codebuddy_2captcha_api_key } = body;
      const updates = {};
      if (auto_9router !== undefined) updates.codebuddy_auto_9router = auto_9router ? "1" : "0";
      if (browser_headless !== undefined) updates.codebuddy_browser_headless = browser_headless ? "1" : "0";
      if (debug_mode !== undefined) updates.codebuddy_debug_mode = debug_mode ? "1" : "0";
      if (leave_canva_team !== undefined) updates.codebuddy_leave_canva_team = leave_canva_team ? "1" : "0";
      if (proxy_enabled !== undefined) updates.codebuddy_proxy_enabled = proxy_enabled ? "1" : "0";
      if (proxy_pool !== undefined) updates.codebuddy_proxy_pool = proxy_pool;
      if (leonardo_invite_link !== undefined) updates.leonardo_invite_link = leonardo_invite_link;
      if (codebuddy_2captcha_api_key !== undefined) updates.codebuddy_2captcha_api_key = codebuddy_2captcha_api_key;
      
      await updateSettings(updates);
      return NextResponse.json({ ok: true });
    }

    // ── Action: Auto Generate Email ──────────────────────────────────
    if (action === "auto-generate-email") {
      const { count, provider, run_now, concurrency, domain } = body;
      const targetProvider = provider || "cloudflare";
      const numCount = parseInt(count) || 1;

      const client = await getAmmailClientFromSettings();
      if (!client.configured) {
        return NextResponse.json({ error: "Ammail belum dikonfigurasi di Settings." }, { status: 400 });
      }

      const createdAccounts = [];
      const errors = [];

      for (let i = 0; i < numCount; i++) {
        try {
          let res = null;
          let lastErr = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            const aliasTry = generateHumanAlias();
            try {
              res = await client.createInbox(aliasTry, domain || null);
              break;
            } catch (err) {
              lastErr = err;
              const msg = String(err.message || err).toLowerCase();
              if (msg.includes("alias") && (msg.includes("exist") || msg.includes("taken") || msg.includes("conflict"))) {
                continue;
              }
              break;
            }
          }
          if (!res || !res.inbox || !res.inbox.address) {
            throw lastErr || new Error("Gagal membuat inbox dari Ammail");
          }

          const email = res.inbox.address;
          const alias = res.inbox.alias;
          const password = generateStrongPassword(16);

          const profilesDir = path.resolve(process.cwd(), `profiles/${targetProvider}`);
          const safeEmail = email.replace("@", "_at_").replace(/[^a-z0-9._-]+/g, "_");
          const profileDir = path.join(profilesDir, safeEmail);

          const newId = await insertCodeBuddyAccount(email, password, profileDir, "email", alias, targetProvider);
          createdAccounts.push({ id: newId, email });
        } catch (err) {
          errors.push(err.message || String(err));
        }
      }

      const response = {
        ok: true,
        created: createdAccounts,
        errors
      };

      if (run_now && createdAccounts.length > 0) {
        const targetIds = createdAccounts.map(a => a.id);
        const jobId = uuidv4();
        const concurrencyLimit = parseInt(concurrency) || 3;
        await createCodeBuddyJob(jobId, "signup", targetIds.length);
        runCodeBuddySignupJob(jobId, targetIds, concurrencyLimit).catch(console.error);
        response.job_id = jobId;
      }

      return NextResponse.json(response);
    }

    // ── Action: Add manual Google accounts ───────────────────────────
    if (action === "add-google") {
      const { accounts_text, run_now, concurrency, provider } = body;
      const targetProvider = provider || "cloudflare";
      const raw = (accounts_text || "").trim();
      if (!raw) {
        return NextResponse.json({ error: "Input kosong." }, { status: 400 });
      }

      const existingAccounts = await listCodeBuddyAccounts();
      const existingEmails = new Set(
        existingAccounts
          .filter(a => (a.provider || "cloudflare") === targetProvider)
          .map(a => a.email.toLowerCase())
      );

      const targetIds = [];
      const skipped = [];
      const parseErrors = [];

      const lines = raw.split("\n");
      for (let line of lines) {
        line = line.trim();
        if (!line || line.startsWith("#")) continue;

        const parts = line.replace(",", ":").split(":");
        if (parts.length < 2) {
          parseErrors.push(line);
          continue;
        }

        const email = parts[0].trim().toLowerCase();
        const password = parts.slice(1).join(":").trim();
        if (!email || !password) {
          parseErrors.push(line);
          continue;
        }

        const alreadyExists = existingEmails.has(email);
        if (alreadyExists) {
          skipped.push(email);
          continue;
        }

        const profilesDir = path.resolve(process.cwd(), `profiles/${targetProvider}`);
        const safeEmail = email.replace("@", "_at_").replace(/[^a-z0-9._-]+/g, "_");
        const profileDir = path.join(profilesDir, safeEmail);

        const newId = await insertCodeBuddyAccount(email, password, profileDir, "google", "", targetProvider);
        targetIds.push(newId);
        existingEmails.add(email);
      }

      const response = {
        created: targetIds,
        skipped,
        parse_errors: parseErrors,
      };

      if (run_now && targetIds.length > 0) {
        const jobId = uuidv4();
        const concurrencyLimit = parseInt(concurrency) || 3;
        await createCodeBuddyJob(jobId, "signup", targetIds.length);
        runCodeBuddySignupJob(jobId, targetIds, concurrencyLimit).catch(console.error);
        response.job_id = jobId;
      }

      return NextResponse.json(response);
    }

    // ── Action: Run all pending/failed accounts ─────────────────────
    if (action === "run-all") {
      const concurrencyLimit = parseInt(body.concurrency) || 3;
      const { provider } = body;
      const accounts = await listCodeBuddyAccounts();
      const targetIds = accounts
        .filter(a => {
          const matchesStatus = a.apiKeyStatus === "pending" || a.apiKeyStatus === "failed";
          const matchesProvider = provider ? (a.provider || "cloudflare") === provider : true;
          return matchesStatus && matchesProvider;
        })
        .map(a => a.id);

      if (targetIds.length === 0) {
        return NextResponse.json({ error: "Tidak ada akun pending/failed." }, { status: 400 });
      }

      if (global._codebuddyState.activeJobId) {
        return NextResponse.json({ error: "Ada job lain yang sedang berjalan." }, { status: 400 });
      }

      const jobId = uuidv4();
      await createCodeBuddyJob(jobId, "signup", targetIds.length);
      runCodeBuddySignupJob(jobId, targetIds, concurrencyLimit).catch(console.error);

      return NextResponse.json({ job_id: jobId, count: targetIds.length });
    }

    // ── Action: Stop active job ──────────────────────────────────────
    if (action === "stop") {
      const busy = global._codebuddyState.activeJobId;
      if (!busy) {
        return NextResponse.json({ ok: true, message: "Tidak ada job aktif." });
      }

      global._codebuddyState.stopFlag = true;

      if (global._codebuddyState.activeProcesses) {
        for (const child of global._codebuddyState.activeProcesses) {
          try {
            child.kill("SIGTERM");
          } catch (err) {
            console.error("Failed to kill child:", err);
          }
        }
        global._codebuddyState.activeProcesses.clear();
      }

      return NextResponse.json({
        ok: true,
        active_job_id: busy,
        message: "Stop signal terkirim.",
      });
    }

    // ── Action: Bulk delete accounts ────────────────────────────────
    if (action === "bulk-delete") {
      const { statuses, provider, deleteFrom9router } = body;
      const allowed = new Set(["pending", "failed", "ready"]);
      const validStatuses = (statuses || []).filter(s => allowed.has(s));
      if (validStatuses.length === 0) {
        return NextResponse.json({ error: "No valid statuses provided" }, { status: 400 });
      }

      const deleted = await bulkDeleteCodeBuddyAccounts(validStatuses, provider);
      
      for (const acc of deleted) {
        if (deleteFrom9router && acc.email && acc.provider) {
          await deleteProviderConnectionByEmailAndProvider(acc.email, acc.provider);
        }
        if (acc.profileDir && fs.existsSync(acc.profileDir)) {
          try {
            fs.rmSync(acc.profileDir, { recursive: true, force: true });
          } catch (e) {
            console.error("Failed to delete profile dir:", acc.profileDir, e);
          }
        }
      }

      return NextResponse.json({ deleted: deleted.length, statuses: validStatuses });
    }

    if (action === "bulk-delete-ids") {
      const { ids, provider, deleteFrom9router } = body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return NextResponse.json({ error: "No IDs provided" }, { status: 400 });
      }
      let deletedCount = 0;
      for (const id of ids) {
        try {
          const acc = await getCodeBuddyAccount(id);
          if (acc) {
            if (deleteFrom9router && acc.email && acc.provider) {
              await deleteProviderConnectionByEmailAndProvider(acc.email, acc.provider);
            }
            await deleteCodeBuddyAccount(id);
            if (acc.profileDir && fs.existsSync(acc.profileDir)) {
              fs.rmSync(acc.profileDir, { recursive: true, force: true });
            }
            deletedCount++;
          }
        } catch (e) {
          console.error("Failed to delete account", id, e);
        }
      }
      return NextResponse.json({ deleted: deletedCount });
    }

    // ── Action: Bulk add ready accounts to 9router ─────────────────
    if (action === "bulk-add-to-9router") {
      const { provider } = body;
      const accounts = await listCodeBuddyAccounts();
      const ready = accounts.filter(a => {
        const matchesStatus = a.apiKeyStatus === "ready" && a.apiKey;
        const matchesProvider = provider ? (a.provider || "cloudflare") === provider : true;
        return matchesStatus && matchesProvider;
      });
      if (ready.length === 0) {
        return NextResponse.json({ ok: true, total: 0, success: 0, failed: 0, message: "Tidak ada akun ready." });
      }

      let success = 0;
      let failed = 0;
      const errors = [];

      for (const acc of ready) {
        try {
          const provider = acc.provider || "cloudflare";
          let apiKeyVal = acc.apiKey || "";
          let accountIdVal = acc.email;
          if (apiKeyVal.includes("|")) {
            const parts = apiKeyVal.split("|");
            apiKeyVal = parts[0];
            accountIdVal = parts[1];
          }

          const connData = {
            provider: "cloudflare-ai",
            authType: "apikey",
            name: `Cloudflare (${acc.email})`,
            apiKey: apiKeyVal,
            email: acc.email,
            priority: 1,
            isActive: true,
            testStatus: "unknown",
            providerSpecificData: {
              accountId: accountIdVal,
            }
          };

          // If the script outputs account_id, retrieve it from providerSpecificData/apiKey
          // Let's decode or find it. In codebuddyAccounts, we stored the apiKey.
          // Wait! For cloudflare, we set provider = "cloudflare-ai" when adding to 9router.
          // Let's parse details.
          await createProviderConnection(connData);
          success++;
        } catch (e) {
          failed++;
          errors.push({ email: acc.email, error: e.message || String(e) });
        }
      }

      return NextResponse.json({
        ok: true,
        total: ready.length,
        success,
        failed,
        errors,
        message: `✓ ${success}/${ready.length} akun berhasil ditambahkan ke 9router.`
      });
    }

    if (action === "clear-logs") {
      try {
        const { getAdapter } = await import("@/lib/db/driver.js");
        const db = await getAdapter();
        db.run(
          "UPDATE codebuddyJobs SET status = 'dismissed' WHERE status IN ('completed', 'failed', 'stopped', 'error')"
        );
        if (global._codebuddyState && !global._codebuddyState.activeProcesses?.size) {
          global._codebuddyState.activeJobId = null;
        }
      } catch (e) {
        console.error("clear-logs error:", e);
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Error in POST /api/automation/codebuddy:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ── Background Runner Loop ──
async function runCodeBuddySignupJob(jobId, accountIds, concurrencyLimit) {
  global._codebuddyState.activeJobId = jobId;
  global._codebuddyState.stopFlag = false;

  try {
    await updateCodeBuddyJobStatus(jobId, "running");
    const settings = await getSettings();

    let index = 0;
    const total = accountIds.length;

    const worker = async () => {
      while (index < total) {
        if (global._codebuddyState.stopFlag) break;
        const currentIdx = index++;
        const accountId = accountIds[currentIdx];

        await markCodeBuddyRunning(accountId);
        await updateCodeBuddyJobResult(jobId, currentIdx, {
          status: "running",
          step: "Memulai otomatisasi browser..."
        });

        try {
          await executeCodeBuddySignup(accountId, jobId, currentIdx, settings);
        } catch (e) {
          await markCodeBuddyError(accountId, e.message || String(e));
          await updateCodeBuddyJobResult(jobId, currentIdx, {
            status: "failed",
            error: e.message || String(e),
            ok: false
          });
        }
      }
    };

    const workers = [];
    const limit = Math.min(concurrencyLimit, total);
    for (let i = 0; i < limit; i++) {
      workers.push(worker());
    }

    await Promise.all(workers);
  } catch (e) {
    console.error("Error running job:", e);
  } finally {
    global._codebuddyState.activeJobId = null;
    const finalStatus = global._codebuddyState.stopFlag ? "stopped" : "completed";
    await updateCodeBuddyJobStatus(jobId, finalStatus);
  }
}

function executeCodeBuddySignup(accountId, jobId, idx, settings) {
  return new Promise(async (resolve, reject) => {
    try {
      const account = await getCodeBuddyAccount(accountId);
      if (!account) return reject(new Error("Account not found"));

      const isCloudflare = account.provider === "cloudflare";
      const cfPassword = (account.password || "").trim();
      const cfEmail = (account.email || "").trim();
      const isGAK = cfPassword.length >= 37 || cfPassword.startsWith("cfk_");

      if (isCloudflare && isGAK) {
        const globalApiKey = cfPassword;
        const email = cfEmail;

        try {
          await updateCodeBuddyJobResult(jobId, idx, {
            email: account.email,
            status: "running",
            step: "Menghubungi Cloudflare API..."
          });

          const CF_API = "https://api.cloudflare.com/client/v4";
          const cfHeaders = {
            "X-Auth-Key": globalApiKey,
            "X-Auth-Email": email,
            "Content-Type": "application/json",
          };

          const cfFetch = async (path, options = {}) => {
            const r = await fetch(`${CF_API}${path}`, {
              ...options,
              headers: { ...cfHeaders, ...(options.headers || {}) },
            });
            const d = await r.json();
            if (!d.success) {
              const msg = d.errors?.[0]?.message || "Cloudflare API error";
              throw new Error(msg);
            }
            return d.result;
          };

          await updateCodeBuddyJobResult(jobId, idx, {
            email: account.email, status: "running", step: "Memverifikasi akun Cloudflare..."
          });
          const accounts_ = await cfFetch("/accounts?per_page=1");
          if (!accounts_ || accounts_.length === 0) {
            throw new Error("Tidak ada akun Cloudflare yang ditemukan.");
          }
          const cfAccount = accounts_[0];
          const accountId_ = cfAccount.id;
          const accountName = cfAccount.name;

          await updateCodeBuddyJobResult(jobId, idx, {
            email: account.email, status: "running", step: "Mengambil permission groups..."
          });
          const permGroups = await cfFetch(`/accounts/${accountId_}/tokens/permission_groups`);
          const readGroup = permGroups.find((g) => g.name === "Workers AI Read" || g.name === "Workers AI Write") ||
            permGroups.find((g) =>
              g.name.toLowerCase().includes("workers ai") &&
              g.name.toLowerCase().includes("read") &&
              !g.name.toLowerCase().includes("metadata")
            );
          const editGroup = permGroups.find((g) => g.name === "Workers AI Write") ||
            permGroups.find((g) =>
              g.name.toLowerCase().includes("workers ai") &&
              (g.name.toLowerCase().includes("write") || g.name.toLowerCase().includes("edit")) &&
              !g.name.toLowerCase().includes("metadata")
            ) || readGroup;
          const analyticsGroup = permGroups.find((g) =>
            g.name.toLowerCase().includes("account analytics") && g.name.toLowerCase().includes("read")
          );
          if (!readGroup) {
            throw new Error(`Workers AI permission groups tidak ditemukan.`);
          }

          await updateCodeBuddyJobResult(jobId, idx, {
            email: account.email, status: "running", step: "Membuat API Token Workers AI..."
          });
          const permissionGroups = [{ id: readGroup.id }, { id: editGroup.id }];
          if (analyticsGroup) permissionGroups.push({ id: analyticsGroup.id });

          const tokenResult = await cfFetch("/user/tokens", {
            method: "POST",
            body: JSON.stringify({
              name: `9router Workers AI - ${email}`,
              policies: [{
                effect: "allow",
                permission_groups: permissionGroups,
                resources: { [`com.cloudflare.api.account.${accountId_}`]: "*" },
              }],
            }),
          });

          const newApiToken = tokenResult.value;

          await markCodeBuddySuccess(account.id, `${newApiToken}|${accountId_}`);
          await updateCodeBuddyJobResult(jobId, idx, {
            email: account.email,
            status: "done",
            api_key: newApiToken,
            ok: true
          });

          try {
            const existing = await getProviderConnections({ provider: "cloudflare-ai" });
            if (existing.length > 0) {
              await updateProviderConnection(existing[0].id, {
                apiKey: newApiToken,
                providerSpecificData: { ...(existing[0].providerSpecificData || {}), accountId: accountId_ },
              });
            } else {
              await createProviderConnection({
                provider: "cloudflare-ai",
                authType: "apikey",
                name: `Cloudflare (${accountName})`,
                apiKey: newApiToken,
                email: "",
                priority: 1,
                globalPriority: null,
                defaultModel: null,
                providerSpecificData: { accountId: accountId_ },
                isActive: true,
                testStatus: "active",
              });
            }
          } catch (e) {
            console.error("Cloudflare auto-add failed:", e);
          }

          return resolve();
        } catch (err) {
          const errMsg = err.message || String(err);
          await markCodeBuddyError(account.id, errMsg);
          await updateCodeBuddyJobResult(jobId, idx, {
            email: account.email,
            status: "failed",
            error: errMsg,
            ok: false
          });
          return resolve();
        }
      }

      // Browser automation execution
      const venvPython = getPythonExecutable();
      const scriptPath = path.resolve(process.cwd(), "src/automation/cloudflare_signup.py");
      const profilesDir = path.resolve(process.cwd(), "profiles/cloudflare");

      const args = [
        scriptPath,
        `--email=${account.email}`,
        `--password=${account.password}`,
        `--profiles-dir=${profilesDir}`,
      ];

      const ammailSettings = settings;
      const ammailBaseUrl = ammailSettings.ammail_base_url || "";
      const ammailApiKey = ammailSettings.ammail_api_key || "";
      const ammailDomain = ammailSettings.ammail_default_domain || "";
      if (ammailBaseUrl && ammailApiKey && ammailDomain) {
        args.push(`--ammail-base-url=${ammailBaseUrl}`);
        args.push(`--ammail-api-key=${ammailApiKey}`);
        args.push(`--ammail-domain=${ammailDomain}`);
      }
      
      const captchaKey = settings.codebuddy_2captcha_api_key || "";
      if (captchaKey) {
        args.push(`--2captcha-key=${captchaKey}`);
      }
      
      const slotDelay = (idx % 3) * 5;
      if (slotDelay > 0) {
        args.push(`--stagger-delay=${slotDelay}`);
      }

      if (settings.codebuddy_browser_headless !== "0") {
        args.push("--headless");
      }

      if (settings.codebuddy_proxy_enabled === "1" && settings.codebuddy_proxy_pool) {
        try {
          const pool = JSON.parse(settings.codebuddy_proxy_pool);
          if (Array.isArray(pool) && pool.length > 0) {
            const idxProxy = global._codebuddyState.proxyRoundRobinIdx % pool.length;
            global._codebuddyState.proxyRoundRobinIdx = (idxProxy + 1) % pool.length;
            const chosen = pool[idxProxy];
            const parsed = parseProxyString(chosen);
            if (parsed) {
              args.push(`--proxy-server=${parsed.server}`);
              if (parsed.username) args.push(`--proxy-user=${parsed.username}`);
              if (parsed.password) args.push(`--proxy-pass=${parsed.password}`);
            }
          }
        } catch (e) {
          console.error("Proxy pool error:", e);
        }
      }

      const logDir = path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "logs");
      const logFilePath = path.join(logDir, `automation_${account.email}.log`);
      args.push(`--log-file=${logFilePath}`);

      try {
        fs.mkdirSync(logDir, { recursive: true });
        fs.appendFileSync(
          path.join(logDir, "automation_spawn.log"),
          `[${new Date().toISOString()}] spawning python: ${venvPython} ${args.join(" ")}\n`
        );
      } catch (err) {
        console.error("Failed to write to automation_spawn.log:", err);
      }

      const child = spawn(venvPython, args, {
        env: { ...process.env, DISPLAY: process.env.DISPLAY || ":1" }
      });
      if (global._codebuddyState.activeProcesses) {
        global._codebuddyState.activeProcesses.add(child);
      }

      // Stream raw stdout and stderr directly to the log file as diagnostics
      child.stdout.on("data", (data) => {
        try {
          fs.appendFileSync(logFilePath, data.toString());
        } catch (e) {}
      });

      let stderrAccumulator = "";
      child.stderr.on("data", (data) => {
        const text = data.toString();
        stderrAccumulator += text;
        try {
          fs.appendFileSync(logFilePath, `[STDERR] ${text}`);
        } catch (e) {}
      });

      let lastStep = "Browser diluncurkan...";
      let done = false;

      child.stdout.on("data", async (data) => {
        const lines = data.toString().split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.step) {
              lastStep = parsed.step;
              await updateCodeBuddyJobResult(jobId, idx, {
                email: account.email,
                status: "running",
                step: lastStep
              });
            } else if (parsed.status === "success") {
              done = true;
              const apiKeyToSave = parsed.api_key;
              await markCodeBuddySuccess(account.id, `${apiKeyToSave}|${parsed.account_id || ""}`);
              await updateCodeBuddyJobResult(jobId, idx, {
                email: account.email,
                status: "done",
                api_key: apiKeyToSave,
                ok: true
              });

              if (settings.codebuddy_auto_9router === "1" || isCloudflare) {
                try {
                  const connData = {
                    provider: "cloudflare-ai",
                    authType: "apikey",
                    name: `Cloudflare (${account.email})`,
                    apiKey: apiKeyToSave,
                    email: account.email,
                    priority: 1,
                    isActive: true,
                    testStatus: "active",
                    providerSpecificData: {
                      accountId: parsed.account_id || "",
                    }
                  };
                  await createProviderConnection(connData);
                } catch (e) {
                  console.error("Auto add failed:", e);
                }
              }
            } else if (parsed.status === "error") {
              done = true;
              const errMsg = parsed.error || parsed.message || "Unknown error";
              await markCodeBuddyError(account.id, errMsg);
              await updateCodeBuddyJobResult(jobId, idx, {
                email: account.email,
                status: "failed",
                error: errMsg,
                ok: false
              });
            }
          } catch (e) {}
        }
      });

      child.on("close", async (code) => {
        if (global._codebuddyState.activeProcesses) {
          global._codebuddyState.activeProcesses.delete(child);
        }
        if (!done) {
          let errMsg = global._codebuddyState.stopFlag 
            ? "Dihentikan oleh pengguna." 
            : `Proses terhenti dengan exit code ${code}.`;
          if (stderrAccumulator.trim()) {
            errMsg += ` | Stderr: ${stderrAccumulator.trim()}`;
          }
          await markCodeBuddyError(account.id, errMsg);
          await updateCodeBuddyJobResult(jobId, idx, {
            email: account.email,
            status: "failed",
            error: errMsg,
            ok: false
          });
        }
        resolve();
      });

      child.on("error", async (err) => {
        if (global._codebuddyState.activeProcesses) {
          global._codebuddyState.activeProcesses.delete(child);
        }
        if (!done) {
          const errMsg = global._codebuddyState.stopFlag 
            ? "Dihentikan oleh pengguna." 
            : (err.message || String(err));
          await markCodeBuddyError(account.id, errMsg);
          await updateCodeBuddyJobResult(jobId, idx, {
            email: account.email,
            status: "failed",
            error: errMsg,
            ok: false
          });
        }
        resolve();
      });

    } catch (e) {
      reject(e);
    }
  });
}
