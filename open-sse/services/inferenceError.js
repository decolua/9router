import { ERROR_CATEGORY as C, OAUTH_PERMANENT_MARKERS, REVOKED, EXHAUSTED, TIMED_OUT, NETWORK_FAILURE, RESET_HEADERS } from "../config/inferenceErrors.js";
import { HTTP_STATUS as S } from "../config/runtimeConfig.js";

export function reportedReset(headers, resetsAtMs, now = Date.now()) {
  const get = key => headers?.get?.(key) ?? headers?.[key];
  const retry = get("retry-after");
  const candidates = [resetsAtMs];
  if (retry) candidates.push(/^\d+(\.\d+)?$/.test(retry) ? now + Number(retry) * 1000 : Date.parse(retry));
  for (const key of RESET_HEADERS) {
    const value = get(key);
    if (!value) continue;
    if (/^(?:\d{10}|\d{13})$/.test(value)) candidates.push(Number(value) * (value.length === 10 ? 1000 : 1));
    else if (/^\d{1,9}$/.test(value)) candidates.push(now + Number(value) * 1000);
    else if (/^\d{4}-/.test(value)) candidates.push(Date.parse(value));
    else if (/^(?:\d+(?:\.\d+)?(?:ms|s|m|h))+$/.test(value)) {
      const units = { ms: 1, s: 1000, m: 60000, h: 3600000 };
      candidates.push(now + [...value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)].reduce((n, [,v,u]) => n + Number(v) * units[u], 0));
    }
  }
  const reset = candidates.find(ms => Number.isFinite(ms) && ms >= now && Number.isFinite(new Date(ms).getTime()));
  return reset == null ? null : new Date(reset).toISOString();
}

// Observation only; never use these labels to decide whether to retry or lock an account.
export function classifyInferenceError({ status, body, headers, resetsAtMs, refreshFailed, quotaExhausted, error, now = Date.now() } = {}) {
  const message = typeof body === "string" ? body : JSON.stringify(body ?? "");
  const cause = [error?.name, error?.message, error?.code, error?.cause?.code].join(" ");
  let category = C.UNKNOWN;
  if (refreshFailed || OAUTH_PERMANENT_MARKERS.some(marker => message.toLowerCase().includes(marker)) || REVOKED.test(message)) category = C.INVALID;
  else if (quotaExhausted || EXHAUSTED.test(message)) category = C.QUOTA;
  else if (status === S.RATE_LIMITED) category = C.RATE;
  else if (status === S.REQUEST_TIMEOUT || status === S.GATEWAY_TIMEOUT || TIMED_OUT.test(cause)) category = C.TIMEOUT;
  else if (NETWORK_FAILURE.test(cause)) category = C.NETWORK;
  else if (status === S.UNAUTHORIZED || /(?:access[_ ]?token|credentials?) (?:has |is )?expired/i.test(message)) category = C.EXPIRED;
  else if (status >= S.SERVER_ERROR) category = C.UPSTREAM;
  else if (status >= S.BAD_REQUEST && status < S.SERVER_ERROR) category = C.BAD;
  return { category, rateLimitResetAt: [C.RATE, C.QUOTA].includes(category) ? reportedReset(headers, resetsAtMs, now) : null };
}
