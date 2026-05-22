/**
 * xAI Image Endpoints
 *
 * Source of truth: router-for-me/CLIProxyAPI internal/runtime/executor/xai_executor.go
 * (image branches)
 *
 * - POST /v1/images/generations  (JSON)
 * - POST /v1/images/edits        (multipart/form-data)
 *
 * Auth + 401 retry semantics mirror executor.js. Idempotency-Key is forwarded
 * from the inbound request when present.
 */

import { XAI_API_BASE } from "../../oauth/constants/xai.js";
import { resolveXaiBearer, refreshXaiAccount } from "./executor.js";

const XAI_IMAGES_GEN_URL = `${XAI_API_BASE}/images/generations`;
const XAI_IMAGES_EDIT_URL = `${XAI_API_BASE}/images/edits`;

function buildBaseHeaders({ token, idempotencyKey, accept = "application/json" }) {
  const headers = {
    Accept: accept,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return headers;
}

async function singleRetryOn401(doFetch, account, opts = {}) {
  let active = account;
  let res = await doFetch(resolveXaiBearer(active));
  if (res.status === 401 && active?.authType !== "apikey") {
    try {
      const { account: refreshed, refreshed: didRefresh } = await refreshXaiAccount(active, { persist: opts.persist });
      if (didRefresh) {
        active = refreshed;
        try { await res.body?.cancel?.(); } catch { /* noop */ }
        res = await doFetch(resolveXaiBearer(active));
      }
    } catch (err) {
      const e = new Error("xAI refresh failed: " + (err?.message || String(err)));
      e.status = 401;
      e.code = "needs_reauth";
      throw e;
    }
  }
  return { res, account: active };
}

/**
 * POST /v1/images/generations on xAI.
 *
 * @param {object} opts
 * @param {object} opts.request   OpenAI images.generations-shaped JSON
 * @param {object} opts.account
 * @param {AbortSignal} [opts.signal]
 * @param {string} [opts.idempotencyKey]
 * @param {(updated: object) => Promise<void>} [opts.persist]
 * @returns {Promise<object>}  parsed JSON response
 */
export async function imagesGenerate({ request, account, signal, idempotencyKey, persist }) {
  const doFetch = (token) =>
    fetch(XAI_IMAGES_GEN_URL, {
      method: "POST",
      headers: { ...buildBaseHeaders({ token, idempotencyKey }), "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });

  const { res } = await singleRetryOn401(doFetch, account, { persist });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    const err = new Error(`xAI /images/generations failed: ${res.status} ${errBody.slice(0, 500)}`);
    err.status = res.status;
    if (res.status === 401) err.code = "needs_reauth";
    throw err;
  }
  return await res.json();
}

/**
 * POST /v1/images/edits on xAI (multipart).
 *
 * Accepts either:
 *   - a pre-built FormData (preferred — caller streams from incoming request)
 *   - a plain object that we convert into FormData
 *
 * Caller must NOT set Content-Type — fetch + FormData produces the correct
 * multipart boundary automatically.
 */
export async function imagesEdit({ formData, account, signal, idempotencyKey, persist }) {
  if (!(formData instanceof FormData)) {
    throw new Error("imagesEdit requires FormData (use buildImagesEditForm helper)");
  }
  const doFetch = (token) =>
    fetch(XAI_IMAGES_EDIT_URL, {
      method: "POST",
      headers: buildBaseHeaders({ token, idempotencyKey }),
      body: formData,
      signal,
    });

  const { res } = await singleRetryOn401(doFetch, account, { persist });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    const err = new Error(`xAI /images/edits failed: ${res.status} ${errBody.slice(0, 500)}`);
    err.status = res.status;
    if (res.status === 401) err.code = "needs_reauth";
    throw err;
  }
  return await res.json();
}

/**
 * Helper: convert a plain object of fields into FormData, useful for tests
 * and small server-side composing. Image and mask values must be Blobs.
 */
export function buildImagesEditForm(fields) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields || {})) {
    if (v == null) continue;
    if (v instanceof Blob || v instanceof File) fd.append(k, v);
    else fd.append(k, String(v));
  }
  return fd;
}
