/**
 * xAI Video Endpoints
 *
 * Source of truth: router-for-me/CLIProxyAPI internal/runtime/executor/xai_executor.go
 * (video branches)
 *
 * - POST /v1/videos/generations  (JSON, async job)
 * - POST /v1/videos/edits        (multipart, async job)
 * - POST /v1/videos/extensions   (multipart, async job)
 * - GET  /v1/videos/{id}         (poll status)
 *
 * Auth + 401 retry semantics mirror executor.js. Idempotency-Key is forwarded
 * on POSTs. CLIProxyAPI does NOT synthesize completion locally — caller polls
 * GET /v1/videos/{id} until terminal state.
 */

import { XAI_API_BASE } from "../../oauth/constants/xai.js";
import { resolveXaiBearer, refreshXaiAccount } from "./executor.js";

const VIDEOS_BASE = `${XAI_API_BASE}/videos`;
const VIDEOS_GEN_URL = `${VIDEOS_BASE}/generations`;
const VIDEOS_EDIT_URL = `${VIDEOS_BASE}/edits`;
const VIDEOS_EXTEND_URL = `${VIDEOS_BASE}/extensions`;

function buildHeaders({ token, idempotencyKey, contentType }) {
  const h = {
    Accept: "application/json",
  };
  if (token) h.Authorization = `Bearer ${token}`;
  if (idempotencyKey) h["Idempotency-Key"] = idempotencyKey;
  if (contentType) h["Content-Type"] = contentType;
  return h;
}

async function singleRetryOn401(doFetch, account, opts = {}) {
  let active = account;
  let res = await doFetch(resolveXaiBearer(active));
  if (res.status === 401 && active?.authType !== "apikey") {
    try {
      const { account: refreshed, refreshed: didRefresh } =
        await refreshXaiAccount(active, { persist: opts.persist });
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

async function jsonOrThrow(res, label) {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`xAI ${label} failed: ${res.status} ${body.slice(0, 500)}`);
    err.status = res.status;
    if (res.status === 401) err.code = "needs_reauth";
    throw err;
  }
  return await res.json();
}

export async function videosGenerate({ request, account, signal, idempotencyKey, persist }) {
  const doFetch = (token) =>
    fetch(VIDEOS_GEN_URL, {
      method: "POST",
      headers: buildHeaders({ token, idempotencyKey, contentType: "application/json" }),
      body: JSON.stringify(request),
      signal,
    });
  const { res } = await singleRetryOn401(doFetch, account, { persist });
  return await jsonOrThrow(res, "/videos/generations");
}

export async function videosEdit({ formData, account, signal, idempotencyKey, persist }) {
  if (!(formData instanceof FormData)) {
    throw new Error("videosEdit requires FormData");
  }
  const doFetch = (token) =>
    fetch(VIDEOS_EDIT_URL, {
      method: "POST",
      headers: buildHeaders({ token, idempotencyKey }),
      body: formData,
      signal,
    });
  const { res } = await singleRetryOn401(doFetch, account, { persist });
  return await jsonOrThrow(res, "/videos/edits");
}

export async function videosExtend({ formData, account, signal, idempotencyKey, persist }) {
  if (!(formData instanceof FormData)) {
    throw new Error("videosExtend requires FormData");
  }
  const doFetch = (token) =>
    fetch(VIDEOS_EXTEND_URL, {
      method: "POST",
      headers: buildHeaders({ token, idempotencyKey }),
      body: formData,
      signal,
    });
  const { res } = await singleRetryOn401(doFetch, account, { persist });
  return await jsonOrThrow(res, "/videos/extensions");
}

export async function videosGet({ id, account, signal, persist }) {
  if (!id) throw new Error("videosGet requires an id");
  const url = `${VIDEOS_BASE}/${encodeURIComponent(id)}`;
  const doFetch = (token) =>
    fetch(url, {
      method: "GET",
      headers: buildHeaders({ token }),
      signal,
    });
  const { res } = await singleRetryOn401(doFetch, account, { persist });
  return await jsonOrThrow(res, `GET /videos/${id}`);
}

export const __XAI_VIDEOS_TEST__ = {
  VIDEOS_GEN_URL,
  VIDEOS_EDIT_URL,
  VIDEOS_EXTEND_URL,
  VIDEOS_BASE,
};
