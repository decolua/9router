import { DefaultExecutor } from "./default.js";
import { refreshMiniMaxCodeToken } from "../services/tokenRefresh.js";
import { getLeaseToken, invalidateLeaseToken, isLeaseConnection } from "../services/minimaxCodeLease.js";

// MiniMax Code reports credit/quota exhaustion as 402/403 (and 429) with a
// body that names the balance. chatCore treats 401/403 as refresh-and-retry
// and 429 as switch-to-the-next-account, so a credits refusal left at 402/403
// would keep retrying a half-spent account instead of failing over. The word
// list is magpie's minimax plugin (answer()); a 403 that does NOT name the
// balance passes through untouched — that one is a real auth refusal and the
// refresh path should see it.
const QUOTA_RE = /insufficient|balance|credit|quota|exhaust|limit|余额|积分|额度|不足|用完|上限/i;

// Exported for tests — exercises the status/body matrix without network.
export async function normalizeQuotaResponse(response) {
  const status = response?.status;
  if (!response || (status !== 402 && status !== 403 && status !== 429)) return response;

  const text = await response.text().catch(() => "");
  // A 429 is already the right signal for the account loop — pass it through
  // as-is. 402/403 that don't name the balance are auth failures — likewise.
  if (status === 429 || !QUOTA_RE.test(text)) {
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    return new Response(text, { status, statusText: response.statusText, headers });
  }

  let msg = text.trim();
  try {
    const v = JSON.parse(text);
    msg = v?.error?.message ?? v?.message ?? v?.msg ?? v?.base_resp?.status_msg ?? msg;
  } catch { /* keep raw text */ }
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.set("content-type", "application/json");
  return new Response(
    JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: `usage limit reached: ${msg}` } }),
    { status: 429, statusText: "Too Many Requests", headers }
  );
}

export class MinimaxCodeExecutor extends DefaultExecutor {
  async execute(args) {
    // Lease connections carry no stored token — borrow one from the desktop
    // broker per request (the lease manager caches until near expiry).
    if (isLeaseConnection(args?.credentials)) {
      const lease = await getLeaseToken(args.credentials, args.log);
      args = { ...args, credentials: { ...args.credentials, accessToken: lease.accessToken } };
    }
    const result = await super.execute(args);
    if (!result?.response) return result;
    return { ...result, response: await normalizeQuotaResponse(result.response) };
  }

  // Lease mode: a 401 means the borrowed token went stale (or the desktop
  // app rotated it) — drop the cache and take a fresh lease. No refresh token
  // is involved, so returning { accessToken } reuses chatCore's retry-once
  // path unchanged. OAuth mode: route through REFRESH_HANDLERS' handler
  // (single-use refresh tokens, deduped by token value) instead of the
  // generic grant builder — the default path would re-send a spent token.
  async refreshCredentials(credentials, log) {
    if (isLeaseConnection(credentials)) {
      try {
        invalidateLeaseToken(credentials, "upstream 401", log);
        const lease = await getLeaseToken(credentials, log);
        return { accessToken: lease.accessToken };
      } catch (error) {
        log?.warn?.("TOKEN", `MCODE lease refresh failed: ${error.message}`);
        return null;
      }
    }
    if (!credentials?.refreshToken) return null;
    return refreshMiniMaxCodeToken(this.provider, credentials.refreshToken, log);
  }
}
