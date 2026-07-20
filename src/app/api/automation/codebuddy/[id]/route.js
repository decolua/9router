import { NextResponse } from "next/server";
import { spawn, spawnSync } from "child_process";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { getSettings } from "@/lib/localDb.js";
import { 
  getCodeBuddyAccount, deleteCodeBuddyAccount, markCodeBuddyRunning,
  markCodeBuddySuccess, markCodeBuddyError, markCanvaEnrolled, createCodeBuddyJob, updateCodeBuddyJobResult,
  createProviderConnection, getProviderConnections, updateCodeBuddyJobStatus,
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

function parseProxyString(raw) {
  if (!raw) return null;
  raw = raw.trim();
  const badUrl = raw.match(/^(https?|socks[45]?):\/\/([^:]+):(\d+):([^:]+):(.+)$/);
  if (badUrl) {
    const [, , host, port, user, pass] = badUrl;
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
  if (parts.length === 4 && /^\d+$/.test(parts[1]))
    return { server: `http://${parts[0]}:${parts[1]}`, username: parts[2], password: parts[3] };
  if (parts.length === 2 && /^\d+$/.test(parts[1]))
    return { server: `http://${parts[0]}:${parts[1]}` };
  return null;
}

export async function POST(request, { params }) {
  try {
    const resolvedParams = await params;
    const accountId = parseInt(resolvedParams.id);
    const body = await request.json();
    const { action, deleteFrom9router } = body;

    const account = await getCodeBuddyAccount(accountId);
    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    // ── Action: Run single account automation ────────────────────────
    if (action === "run") {
      if (global._codebuddyState?.activeJobId) {
        return NextResponse.json({ error: "Ada job lain yang sedang berjalan." }, { status: 400 });
      }

      const jobId = uuidv4();
      await createCodeBuddyJob(jobId, "signup", 1);
      
      // Background worker run single
      runSingleJob(jobId, accountId).catch(console.error);

      return NextResponse.json({ job_id: jobId, count: 1 });
    }

    // ── Action: Inject API key to 9router ───────────────────────────
    if (action === "add-to-9router") {
      if (account.apiKeyStatus !== "ready" || !account.apiKey) {
        return NextResponse.json({ error: "Akun belum ready (restricted atau gagal)." }, { status: 400 });
      }

      try {
        const provider = account.provider || "cloudflare";
        let apiKeyVal = account.apiKey || "";
        let accountIdVal = account.email;
        if (apiKeyVal.includes("|")) {
          const parts = apiKeyVal.split("|");
          apiKeyVal = parts[0];
          accountIdVal = parts[1];
        }

        const connData = {
          provider: "cloudflare-ai",
          authType: "apikey",
          name: `Cloudflare (${account.email})`,
          apiKey: apiKeyVal,
          email: account.email,
          priority: 1,
          isActive: true,
          testStatus: "unknown",
        };

        if (provider === "cloudflare") {
          connData.provider = "cloudflare-ai";
          connData.authType = "apikey";
          connData.apiKey = apiKeyVal;
          connData.providerSpecificData = {
            accountId: accountIdVal,
          };
        }

        await createProviderConnection(connData);
        return NextResponse.json({ ok: true, email: account.email, message: `✓ ${account.email} berhasil ditambahkan ke provider ${provider} di 9router.` });
      } catch (e) {
        return NextResponse.json({ error: `Gagal menambahkan ke 9router: ${e.message}` }, { status: 500 });
      }
    }

    // ── Action: Delete account ───────────────────────────────────────
    if (action === "delete") {
      if (deleteFrom9router && account.email && account.provider) {
        await deleteProviderConnectionByEmailAndProvider(account.email, account.provider);
      }
      await deleteCodeBuddyAccount(accountId);
      
      // Delete profile dir
      if (account.profileDir && fs.existsSync(account.profileDir)) {
        try {
          fs.rmSync(account.profileDir, { recursive: true, force: true });
        } catch (e) {
          console.error("Failed to delete profile dir:", account.profileDir, e);
        }
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Error in POST /api/automation/codebuddy/[id]:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(request, { params }) {
  try {
    const resolvedParams = await params;
    const accountId = parseInt(resolvedParams.id);
    const account = await getCodeBuddyAccount(accountId);
    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const logDir = path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "logs");
    const logFilePath = path.join(logDir, `automation_${account.email}.log`);

    if (fs.existsSync(logFilePath)) {
      const logs = fs.readFileSync(logFilePath, "utf8");
      return NextResponse.json({ logs });
    } else {
      return NextResponse.json({ logs: "Belum ada log untuk akun ini." });
    }
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function runSingleJob(jobId, accountId) {
  global._codebuddyState.activeJobId = jobId;
  global._codebuddyState.stopFlag = false;

  try {
    await updateCodeBuddyJobStatus(jobId, "running");
    const settings = await getSettings();

    await markCodeBuddyRunning(accountId);
    await updateCodeBuddyJobResult(jobId, 0, {
      status: "running",
      step: "Memulai otomatisasi browser..."
    });

    await executeCodeBuddySignupSingle(accountId, jobId, settings);
  } catch (e) {
    console.error("Error running single CodeBuddy job:", e);
  } finally {
    global._codebuddyState.activeJobId = null;
    const finalStatus = global._codebuddyState.stopFlag ? "stopped" : "completed";
    await updateCodeBuddyJobStatus(jobId, finalStatus);
  }
}

function executeCodeBuddySignupSingle(accountId, jobId, settings) {
  return new Promise(async (resolve, reject) => {
    try {
      const account = await getCodeBuddyAccount(accountId);
      if (!account) return reject(new Error("Account not found"));

      const isCloudflare = account.provider === "cloudflare";

      const venvPython = getPythonExecutable();
      const scriptPath = isCloudflare
        ? path.resolve(process.cwd(), "src/automation/cloudflare_signup.py")
        : path.resolve(process.cwd(), "src/automation/cloudflare_signup.py");
      const profilesDir = isCloudflare
        ? path.resolve(process.cwd(), "profiles/cloudflare")
        : path.resolve(process.cwd(), "profiles/cloudflare");

      const args = [
        scriptPath,
        `--email=${account.email}`,
        `--password=${account.password}`,
        `--profiles-dir=${profilesDir}`,
      ];

      if (isCloudflare) {
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
      }

      if (settings.codebuddy_browser_headless !== "0") {
        args.push("--headless");
      }

      if (settings.codebuddy_proxy_enabled === "1" && settings.codebuddy_proxy_pool) {
        try {
          const pool = JSON.parse(settings.codebuddy_proxy_pool);
          if (Array.isArray(pool) && pool.length > 0) {
            const chosen = pool[Math.floor(Math.random() * pool.length)];
            const parsed = parseProxyString(chosen);
            if (parsed) {
              args.push(`--proxy-server=${parsed.server}`);
              if (parsed.username) args.push(`--proxy-user=${parsed.username}`);
              if (parsed.password) args.push(`--proxy-pass=${parsed.password}`);
            }
          }
        } catch (e) {
          console.error("Failed to parse proxy pool:", e);
        }
      }

      const logDir = path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "logs");
      const logFilePath = path.join(logDir, `automation_${account.email}.log`);
      args.push(`--log-file=${logFilePath}`);

      try {
        fs.mkdirSync(logDir, { recursive: true });
        fs.appendFileSync(
          path.join(logDir, "automation_spawn.log"),
          `[${new Date().toISOString()}] [id]/route.js spawning python: ${venvPython} ${args.join(" ")}\n`
        );
      } catch (err) {
        console.error("Failed to write to automation_spawn.log:", err);
      }

      const child = spawn(venvPython, args, {
        env: { ...process.env, DISPLAY: process.env.DISPLAY || ":1" }
      });
      if (global._codebuddyState?.activeProcesses) {
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
              await updateCodeBuddyJobResult(jobId, 0, {
                email: account.email,
                status: "running",
                step: lastStep
              });
            } else if (parsed.status === "success") {
              done = true;
              const apiKeyToSave = parsed.api_key;
              await markCodeBuddySuccess(account.id, `${apiKeyToSave}|${parsed.account_id || ""}`);
              await updateCodeBuddyJobResult(jobId, 0, {
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
                  console.error("Auto add to 9router failed:", e);
                }
              }
            } else if (parsed.status === "error") {
              done = true;
              await markCodeBuddyError(account.id, parsed.message || parsed.error);
              await updateCodeBuddyJobResult(jobId, 0, {
                email: account.email,
                status: "failed",
                error: parsed.message || parsed.error,
                ok: false
              });
            }
          } catch (e) {}
        }
      });

      child.on("close", async (code) => {
        if (global._codebuddyState?.activeProcesses) {
          global._codebuddyState.activeProcesses.delete(child);
        }
        if (!done) {
          let errMsg = global._codebuddyState?.stopFlag 
            ? "Dihentikan oleh pengguna." 
            : `Proses terhenti dengan exit code ${code}.`;
          if (stderrAccumulator.trim()) {
            errMsg += ` | Stderr: ${stderrAccumulator.trim()}`;
          }
          await markCodeBuddyError(account.id, errMsg);
          await updateCodeBuddyJobResult(jobId, 0, {
            email: account.email,
            status: "failed",
            error: errMsg,
            ok: false
          });
        }
        resolve();
      });

      child.on("error", async (err) => {
        if (global._codebuddyState?.activeProcesses) {
          global._codebuddyState.activeProcesses.delete(child);
        }
        if (!done) {
          const errMsg = global._codebuddyState?.stopFlag 
            ? "Dihentikan oleh pengguna." 
            : (err.message || String(err));
          await markCodeBuddyError(account.id, errMsg);
          await updateCodeBuddyJobResult(jobId, 0, {
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
