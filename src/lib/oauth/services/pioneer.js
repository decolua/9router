import { PIONEER_CONFIG } from "../constants/oauth.js";

/**
 * Pioneer AI Auth Service
 *
 * Pioneer (https://pioneer.ai) uses Supabase Auth (gotrue-js) under
 * https://db.pioneer.ai for the web app session, and a separate API key
 * scheme (X-API-Key: pio_sk_...) on https://api.pioneer.ai for inference.
 *
 * 9Router's stable runtime credential is the long-lived `pio_sk_` API key,
 * because it is static, header-only, and not bound to a refreshable Supabase
 * session. This service therefore funnels every supported login path
 * (email+password, Supabase refresh token, raw API key) into a single
 * pio_sk_ key that we persist as `apiKey` on the connection.
 *
 * Login paths:
 *   1. Direct API key paste            -> validate via /list-api-keys
 *   2. Supabase refresh_token import   -> refresh -> mint pio_sk_ key
 *   3. Email + password (Supabase)     -> sign-in -> mint pio_sk_ key
 */

const SUPABASE_URL = PIONEER_CONFIG.supabaseUrl;
const SUPABASE_ANON_KEY = PIONEER_CONFIG.supabaseAnonKey;
const API_BASE = PIONEER_CONFIG.apiBaseUrl;

const KEY_PREFIX = "pio_sk_";

function ensureKeyShape(key) {
  if (typeof key !== "string" || !key.startsWith(KEY_PREFIX)) {
    throw new Error("Invalid Pioneer API key format. Expected pio_sk_...");
  }
  return key.trim();
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { _raw: text }; }
}

export class PioneerService {
  /**
   * Sign in with email + password against Supabase gotrue-js.
   * Pioneer enforces hCaptcha on password sign-in (sitekey
   * c646a2ec-0a3e-415c-affe-c502978ede9c). The caller MUST supply a valid
   * captchaToken obtained client-side; without it gotrue returns 400 with
   * `captcha_failed`. Returns { accessToken, refreshToken, expiresAt, user }.
   */
  async signInWithPassword(email, password, captchaToken = null) {
    if (!email || !password) {
      throw new Error("Email and password are required");
    }
    const url = `${SUPABASE_URL}/auth/v1/token?grant_type=password`;
    const body = { email, password };
    if (captchaToken) {
      body.gotrue_meta_security = { captcha_token: captchaToken };
    }
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Accept": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await readJson(response);
    if (!response.ok) {
      const errorCode = data?.error_code || data?.error || "";
      const msg = data?.error_description || data?.msg || data?.error || data?._raw || `HTTP ${response.status}`;
      const e = new Error(`Pioneer login failed: ${msg}`);
      e.code = errorCode;
      e.status = response.status;
      e.captchaRequired = errorCode === "captcha_failed" || /captcha/i.test(msg);
      throw e;
    }
    if (!data?.access_token || !data?.refresh_token) {
      throw new Error("Pioneer login: missing tokens in response");
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      tokenType: data.token_type || "bearer",
      user: data.user || null,
    };
  }

  /**
   * Exchange a Supabase refresh token for a fresh access token.
   */
  async refreshSession(refreshToken) {
    if (!refreshToken) throw new Error("Refresh token is required");
    const url = `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Accept": "application/json",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    const data = await readJson(response);
    if (!response.ok) {
      const msg = data?.error_description || data?.msg || data?.error || data?._raw || `HTTP ${response.status}`;
      throw new Error(`Pioneer refresh failed: ${msg}`);
    }
    if (!data?.access_token) {
      throw new Error("Pioneer refresh: missing access_token in response");
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresIn: data.expires_in,
      tokenType: data.token_type || "bearer",
      user: data.user || null,
    };
  }

  /**
   * Mint a Pioneer pio_sk_ API key using the user's Supabase access token.
   * Pioneer's REST API accepts the Supabase JWT as Bearer for /create-api-key.
   * The full key value is only returned at creation time, so we capture it here.
   */
  async createApiKey(accessToken, name = "9Router") {
    if (!accessToken) throw new Error("Access token is required");
    const url = `${API_BASE}/create-api-key`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
      },
      body: JSON.stringify({ name }),
    });

    const data = await readJson(response);
    if (!response.ok) {
      const msg = data?.error || data?.message || data?._raw || `HTTP ${response.status}`;
      throw new Error(`Pioneer create-api-key failed: ${msg}`);
    }
    const key = data?.key || data?.api_key || data?.apiKey;
    if (!key) {
      throw new Error("Pioneer create-api-key: response missing key");
    }
    return {
      apiKey: ensureKeyShape(key),
      keyId: data.id || data.key_id || null,
      name: data.name || name,
      createdAt: data.created_at || null,
    };
  }

  /**
   * Validate a pio_sk_ API key by hitting /list-api-keys. A 200 with a JSON
   * body is treated as valid. 401/403 = invalid; other status surfaces as
   * an error so the caller can log it.
   */
  async validateApiKey(apiKey) {
    const key = ensureKeyShape(apiKey);
    const url = `${API_BASE}/list-api-keys`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-API-Key": key,
        "Accept": "application/json",
      },
      // generous timeout via AbortSignal to avoid hanging the validate route
      signal: AbortSignal.timeout(10000),
    });

    if (response.status === 401 || response.status === 403) {
      return { valid: false, error: "Invalid or revoked Pioneer API key" };
    }
    if (!response.ok) {
      const data = await readJson(response);
      const msg = data?.error || data?.message || data?._raw || `HTTP ${response.status}`;
      return { valid: false, error: msg };
    }
    return { valid: true, error: null };
  }

  /**
   * Extract email / sub from a Supabase JWT for display. Best-effort.
   */
  extractEmailFromAccessToken(accessToken) {
    try {
      if (!accessToken) return null;
      const parts = accessToken.split(".");
      if (parts.length !== 3) return null;
      let payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      while (payload.length % 4) payload += "=";
      const decoded = Buffer.from(payload, "base64").toString("utf-8");
      const json = JSON.parse(decoded);
      return json.email || json.user_metadata?.email || json.preferred_username || json.sub || null;
    } catch {
      return null;
    }
  }

  /**
   * Convenience: full email+password -> API key flow.
   * Used by the email-login API route to keep the caller small.
   */
  async loginAndMintKey(email, password, keyName, captchaToken = null) {
    const session = await this.signInWithPassword(email, password, captchaToken);
    const minted = await this.createApiKey(session.accessToken, keyName || `9Router (${email})`);
    return {
      apiKey: minted.apiKey,
      keyId: minted.keyId,
      email: this.extractEmailFromAccessToken(session.accessToken) || email,
      refreshToken: session.refreshToken,
    };
  }

  /**
   * Convenience: refresh-token -> API key flow.
   */
  async refreshAndMintKey(refreshToken, keyName) {
    const session = await this.refreshSession(refreshToken);
    const email = this.extractEmailFromAccessToken(session.accessToken);
    const minted = await this.createApiKey(session.accessToken, keyName || `9Router (${email || "imported"})`);
    return {
      apiKey: minted.apiKey,
      keyId: minted.keyId,
      email,
      refreshToken: session.refreshToken,
    };
  }

  // ───────────────────────── Training Jobs (Fine-Tuning) ─────────────────────
  // Pioneer's gated decoder models (Claude/GPT/Gemini, plus many enterprise
  // and some open-tier models with `supports_on_demand_inference: false`)
  // are NOT callable via /v1/chat/completions with the base model id. They
  // require a completed fine-tuning training job; the resulting `job_id` is
  // then passed as `model` (OpenAI-compat) or `model_id` (native /inference).
  //
  // These helpers wrap the felix/training-jobs REST surface so 9Router can:
  //   1. List user's existing training jobs (to surface completed job_ids
  //      as additional usable model entries on the connection).
  //   2. Start a new fine-tuning job from any base_model.
  //   3. Poll job status / fetch detail.
  //   4. Stop a running job.

  /**
   * GET /felix/training-jobs — list all training jobs for the authed user.
   * Returns array of { id, status, base_model, model_name, created_at, ... }.
   */
  async listTrainingJobs(apiKey, { limit = 100, offset = 0, status = null } = {}) {
    const key = ensureKeyShape(apiKey);
    const params = new URLSearchParams();
    if (Number.isFinite(limit)) params.set("limit", String(limit));
    if (Number.isFinite(offset) && offset > 0) params.set("offset", String(offset));
    if (status) params.set("status", String(status));
    const qs = params.toString();
    const url = `${API_BASE}/felix/training-jobs${qs ? `?${qs}` : ""}`;
    const response = await fetch(url, {
      method: "GET",
      headers: { "X-API-Key": key, "Accept": "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    const data = await readJson(response);
    if (!response.ok) {
      const msg = data?.detail || data?.error || data?._raw || `HTTP ${response.status}`;
      throw new Error(`Pioneer list training-jobs failed: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
    }
    // Pioneer returns either { jobs: [...] } or a bare array depending on version
    const jobs = Array.isArray(data) ? data : (data?.jobs || data?.training_jobs || data?.items || []);
    return jobs;
  }

  /**
   * GET /felix/training-jobs/{id} — single job detail.
   */
  async getTrainingJob(apiKey, jobId) {
    if (!jobId) throw new Error("jobId is required");
    const key = ensureKeyShape(apiKey);
    const url = `${API_BASE}/felix/training-jobs/${encodeURIComponent(jobId)}`;
    const response = await fetch(url, {
      method: "GET",
      headers: { "X-API-Key": key, "Accept": "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    const data = await readJson(response);
    if (!response.ok) {
      const msg = data?.detail || data?.error || data?._raw || `HTTP ${response.status}`;
      throw new Error(`Pioneer get training-job failed: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
    }
    return data;
  }

  /**
   * POST /felix/training-jobs — start a new fine-tuning job.
   * `body` matches Pioneer's spec: { model_name, base_model, datasets:[{name}],
   * training_type:"lora", nr_epochs, learning_rate, ... }.
   */
  async startTrainingJob(apiKey, body) {
    const key = ensureKeyShape(apiKey);
    if (!body || typeof body !== "object") {
      throw new Error("Training job body is required");
    }
    if (!body.base_model) throw new Error("base_model is required");
    if (!body.model_name) throw new Error("model_name is required");

    const url = `${API_BASE}/felix/training-jobs`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "X-API-Key": key,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const data = await readJson(response);
    if (!response.ok) {
      const msg = data?.detail || data?.error || data?._raw || `HTTP ${response.status}`;
      throw new Error(`Pioneer start training-job failed: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
    }
    return data;
  }

  /**
   * POST /felix/training-jobs/{id}/stop — cancel a running job.
   */
  async stopTrainingJob(apiKey, jobId) {
    if (!jobId) throw new Error("jobId is required");
    const key = ensureKeyShape(apiKey);
    const url = `${API_BASE}/felix/training-jobs/${encodeURIComponent(jobId)}/stop`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "X-API-Key": key, "Accept": "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    const data = await readJson(response);
    if (!response.ok) {
      const msg = data?.detail || data?.error || data?._raw || `HTTP ${response.status}`;
      throw new Error(`Pioneer stop training-job failed: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
    }
    return data;
  }

  /**
   * GET /base-models — list base models eligible for inference or training.
   * Public endpoint (no auth required); we still pass key when available so
   * Pioneer can return tier-aware availability flags.
   */
  async listBaseModels({ apiKey = null, taskType = null, supportsInference = null, supportsTraining = null } = {}) {
    const params = new URLSearchParams();
    if (taskType) params.set("task_type", taskType);
    if (supportsInference != null) params.set("supports_inference", String(!!supportsInference));
    if (supportsTraining != null) params.set("supports_training", String(!!supportsTraining));
    const qs = params.toString();
    const url = `${API_BASE}/base-models${qs ? `?${qs}` : ""}`;
    const headers = { "Accept": "application/json" };
    if (apiKey) headers["X-API-Key"] = ensureKeyShape(apiKey);
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(15000),
    });
    const data = await readJson(response);
    if (!response.ok) {
      const msg = data?.detail || data?.error || data?._raw || `HTTP ${response.status}`;
      throw new Error(`Pioneer list base-models failed: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
    }
    return Array.isArray(data) ? data : (data?.models || []);
  }

  /**
   * Convenience: collect every model id this connection can ACTUALLY call
   * via /v1/chat/completions today. That is:
   *   - All base models with supports_on_demand_inference === true.
   *   - All completed training jobs (the user's fine-tuned models, callable
   *     by passing the job id as `model`).
   *
   * Returns [{ id, name, source: "base"|"finetuned", base_model?, status? }, ...].
   * Designed to be the source-of-truth for the per-connection models view in
   * 9Router's dashboard, so users see a single unified list.
   */
  async collectUsableModels(apiKey) {
    const key = ensureKeyShape(apiKey);
    const [baseModels, jobs] = await Promise.all([
      this.listBaseModels({ apiKey: key, supportsInference: true, taskType: "decoder" }),
      this.listTrainingJobs(key, { limit: 200 }).catch(() => []),
    ]);

    const onDemand = (baseModels || [])
      .filter((m) => m && m.supports_on_demand_inference === true)
      .map((m) => ({
        id: m.id,
        name: m.label || m.name || m.id,
        source: "base",
        contextLength: m.context_window,
        tier: m.tier,
      }));

    const completed = (jobs || [])
      .filter((j) => {
        const st = String(j?.status || "").toLowerCase();
        return st === "complete" || st === "completed" || st === "succeeded";
      })
      .map((j) => ({
        id: j.id || j.job_id,
        name: `[FT] ${j.model_name || j.name || j.base_model || j.id}`,
        source: "finetuned",
        base_model: j.base_model || null,
        status: j.status,
        created_at: j.created_at || null,
      }));

    return { onDemand, finetuned: completed };
  }
}
