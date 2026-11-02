/**
 * Service to preview and claim ZCode promotional plans (e.g. ZCODE WEEKEND BUILD, Trust Build).
 * Handles Aliyun NoCaptcha / device attestation natively.
 */
import { createHash } from "node:crypto";
import { getConsistentMachineId } from "@/shared/utils/machineId.js";

const ZCODE_BASE = "https://zcode.z.ai";
const APP_VERSION = "3.16.3";
const PLATFORM = "linux-x64";
const USER_AGENT = `ZCode/${APP_VERSION}`;

/**
 * Fetch available claimable plans for the given ZCode session JWT or API key.
 */
export async function getZCodeClaimablePlans(token, deviceId = null) {
  if (!token) return { ok: false, error: "No token provided", plans: [] };

  const mid = deviceId || (await getConsistentMachineId("zcode-device"));
  const url = `${ZCODE_BASE}/api/v1/zcode-plan/billing/preview?app_version=${APP_VERSION}&platform=${PLATFORM}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": USER_AGENT,
        "X-Device-Mid": mid,
        "X-ZCode-App-Version": APP_VERSION,
        "X-Platform": PLATFORM,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (res.status === 404) {
      return { ok: true, plans: [], message: "No promotional campaign currently active." };
    }

    if (!res.ok) {
      return { ok: false, error: `Preview returned HTTP ${res.status}`, plans: [] };
    }

    const data = await res.json().catch(() => ({}));
    if (data?.code !== 0 && data?.code !== 200) {
      return { ok: false, error: data?.msg || `ZCode error code ${data?.code}`, plans: [] };
    }

    const plans = Array.isArray(data?.data?.plans)
      ? data.data.plans
      : Array.isArray(data?.data?.previews)
        ? data.data.previews
        : [];

    return {
      ok: true,
      plans: plans.map((p) => ({
        planId: p.plan_id || p.id,
        name: p.name || p.title || p.plan_id,
        description: p.description || "",
        priority: p.priority || 0,
        status: p.status || "available",
        grants: p.grants || p.grant_units || 0,
        startsAt: p.starts_at || null,
        endsAt: p.ends_at || null,
      })),
    };
  } catch (err) {
    return { ok: false, error: err.message || "Failed to contact ZCode preview endpoint", plans: [] };
  }
}

/**
 * Execute claim for a specific plan ID using the ZCode session JWT.
 */
export async function claimZCodePlan(token, planId, deviceId = null, captchaParam = "") {
  if (!token) return { ok: false, error: "No token provided" };
  if (!planId) return { ok: false, error: "Plan ID is required" };

  const mid = deviceId || (await getConsistentMachineId("zcode-device"));
  const url = `${ZCODE_BASE}/api/v1/zcode-plan/billing/claim`;

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "User-Agent": USER_AGENT,
    "X-Device-Mid": mid,
    "X-ZCode-App-Version": APP_VERSION,
    "X-Platform": PLATFORM,
  };

  if (captchaParam) {
    headers["X-Aliyun-Captcha-Verify-Param"] = captchaParam;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ plan_id: planId }),
      signal: AbortSignal.timeout(15000),
    });

    const data = await res.json().catch(() => ({}));

    // Success codes
    if (data?.code === 0 || data?.code === 200) {
      return {
        ok: true,
        code: 0,
        message: "Bonus plan successfully claimed!",
        plan: data?.data?.plan || null,
      };
    }

    if (data?.code === 1003) {
      return {
        ok: true,
        code: 1003,
        alreadyClaimed: true,
        message: "This bonus plan has already been claimed for your account.",
      };
    }

    if (data?.code === 1005) {
      return {
        ok: false,
        code: 1005,
        error: "Quota for this campaign has been exhausted.",
      };
    }

    if (data?.code === 3007) {
      // If captcha was requested and we haven't tried browser attestation yet
      if (!captchaParam) {
        const solved = await solveAliyunCaptchaForZCode(token, mid);
        if (solved) {
          return await claimZCodePlan(token, planId, mid, solved);
        }
      }
      return {
        ok: false,
        code: 3007,
        error: "Aliyun verification challenge required.",
      };
    }

    return {
      ok: false,
      code: data?.code ?? res.status,
      error: data?.msg || `Claim failed with HTTP ${res.status}`,
    };
  } catch (err) {
    return { ok: false, error: err.message || "Failed to submit claim" };
  }
}

/**
 * Solve or generate Aliyun NoCaptcha token via headless Playwright if needed.
 */
async function solveAliyunCaptchaForZCode(token, deviceMid) {
  try {
    let pwModule;
    try {
      pwModule = await import(/* webpackIgnore: true */ "/root/shot/node_modules/playwright/index.js");
    } catch {
      return null;
    }

    const pw = pwModule.default || pwModule;
    if (!pw?.chromium) return null;

    const browser = await pw.chromium.launch({
      headless: true,
      args: ["--no-first-run", "--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
    });

    const context = await browser.newContext({
      userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 ${USER_AGENT}`,
      viewport: { width: 1280, height: 800 },
    });

    const page = await context.newPage();

    let capturedParam = null;
    page.on("request", (req) => {
      const h = req.headers();
      if (h["x-aliyun-captcha-verify-param"]) {
        capturedParam = h["x-aliyun-captcha-verify-param"];
      }
    });

    await page.goto("https://zcode.z.ai/", { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(1500);

    await browser.close();
    return capturedParam;
  } catch {
    return null;
  }
}
