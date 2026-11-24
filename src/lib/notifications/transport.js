import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createHmac } from "node:crypto";
import { Agent, fetch as directFetch } from "undici";
import { assertPublicUrl } from "../../shared/utils/ssrfGuard.js";

const invalid = () => new Error("Invalid notification destination");
export function webhookUrl(raw, allowInsecureLocal) {
  if (typeof raw !== "string" || raw.length > 2048) throw invalid();
  const url = new URL(raw);
  if (url.username || url.password || url.hash ||
    !(url.protocol === "https:" || (url.protocol === "http:" && allowInsecureLocal === true))) throw invalid();
  assertPublicUrl(url.href);
  return url;
}

// Resolve once, check every answer, then give only those addresses to the socket.
// Keep the original hostname for Host, SNI and TLS certificate validation.
export async function destination(url, resolve = lookup, signal = AbortSignal.timeout(5000)) {
  assertPublicUrl(url.href);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const family = isIP(host);
  if (family) return [{ address: host, family }];
  signal.throwIfAborted();
  let onAbort;
  const deadline = new Promise((_, reject) => {
    onAbort = () => reject(invalid());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    const addresses = await Promise.race([resolve(host, { all: true, verbatim: true }), deadline]);
    if (!addresses.length) throw invalid();
    for (const { address, family } of addresses) {
      if (!isIP(address) || isIP(address) !== family) throw invalid();
      assertPublicUrl("https://" + (family === 6 ? `[${address}]` : address));
    }
    return addresses;
  } finally { signal.removeEventListener("abort", onAbort); }
}

export async function channelConfig(input, resolve) {
  if (input.kind === "webhook") {
    const url = webhookUrl(input.url, input.allowInsecureLocal);
    await destination(url, resolve);
    if (input.secret != null && (typeof input.secret !== "string" || input.secret.length > 512)) throw invalid();
    return { url: url.href, allowInsecureLocal: input.allowInsecureLocal === true, secret: input.secret || "" };
  }
  if (input.kind !== "telegram" || typeof input.token !== "string" || !/^\d{1,20}:[\w-]{20,128}$/.test(input.token)
    || typeof input.chatId !== "string" || !/^(?:-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/.test(input.chatId)) throw invalid();
  return { token: input.token, chatId: input.chatId };
}

export async function send(kind, config, payload, { fetcher = directFetch, resolve = lookup } = {}) {
  let dispatcher;
  try {
    const signal = AbortSignal.timeout(5000);
    const headers = { "Content-Type": "application/json" };
    let body = JSON.stringify(payload), url;
    if (kind === "telegram") {
      url = new URL(`https://api.telegram.org/bot${config.token}/sendMessage`);
      body = JSON.stringify({ chat_id: config.chatId, text: body });
    } else {
      url = webhookUrl(config.url, config.allowInsecureLocal);
      if (config.secret) headers["X-9Router-Signature"] = "sha256=" + createHmac("sha256", config.secret).update(body).digest("hex");
    }
    const answers = await destination(url, resolve, signal);
    dispatcher = new Agent({ connect: { lookup: (_host, options, cb) => {
      if (options.all) cb(null, answers);
      else cb(null, answers[0].address, answers[0].family);
    } } });
    const response = await fetcher(url, { method: "POST", headers, body, dispatcher, signal, redirect: "manual" });
    await response.body?.cancel();
    return response.status >= 200 && response.status < 300;
  } catch { return false; }
  finally { if (dispatcher) await dispatcher.destroy(); }
}
