import https from "node:https";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import codex from "../providers/registry/codex.js";
import { convertAudio, readBounded, MAX_AUDIO_BYTES } from "./codexSttAudio.js";
import { createErrorResult } from "../utils/error.js";

let active = 0;
const failure = (status, message) => Object.assign(new Error(message), { status });
const cors = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };

// Keep the signal connected until the response body finishes, not just headers.
export function codexHttpFetch(url, { headers, body, signal }) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const req = https.request(url, { method: "POST", headers, signal }, (res) => {
      const cleanup = () => signal?.removeEventListener("abort", abort);
      const abort = () => res.destroy(signal.reason || new Error("Aborted"));
      signal?.addEventListener("abort", abort, { once: true });
      res.once("close", cleanup);
      res.once("end", cleanup);
      if (signal?.aborted) abort();
      const responseHeaders = new Headers();
      for (const [key, value] of Object.entries(res.headers)) {
        if (value != null) responseHeaders.set(key, Array.isArray(value) ? value.join(", ") : String(value));
      }
      const status = res.statusCode || 502;
      if ([204, 205, 304].includes(status)) {
        res.resume();
        resolve(new Response(null, { status, headers: responseHeaders }));
      } else {
        resolve(new Response(Readable.toWeb(res), { status, headers: responseHeaders }));
      }
    });
    req.once("error", reject);
    req.end(body);
  });
}

export async function transcribeCodex({ formData, credentials, signal: clientSignal, proxyOptions }) {
  let slot = false;
  const signal = AbortSignal.any([...(clientSignal ? [clientSignal] : []), AbortSignal.timeout(60000)]);
  try {
    const account = credentials?.providerSpecificData || {};
    const accountId = account.workspaceId || account.chatgptAccountId || account.accountId;
    if (credentials?.authType !== "oauth" || typeof credentials.accessToken !== "string" || !/^[\x21-\x7e]+$/.test(credentials.accessToken)
      || typeof accountId !== "string" || !/^[\x21-\x7e]{1,256}$/.test(accountId)) {
      throw failure(401, "A valid Codex OAuth account is required");
    }
    for (const [key] of formData) {
      if (!["model", "file", "response_format", "language", "prompt", "temperature"].includes(key) || formData.getAll(key).length !== 1) throw failure(400, "Unsupported or duplicate form field");
    }
    const format = formData.get("response_format") || "json";
    if (!["json", "text"].includes(format)) throw failure(400, "Only json and text response formats are supported");
    for (const key of ["language", "prompt", "temperature"]) {
      if (formData.has(key) && formData.get(key) !== "") throw failure(400, `${key} is not supported by Codex transcription`);
    }
    const file = formData.get("file");
    if (!(file instanceof Blob) || !file.size) throw failure(400, "A non-empty audio file is required");
    if (file.size > MAX_AUDIO_BYTES) throw failure(413, "Audio exceeds 25 MiB");
    if (proxyOptions?.source === "error") throw failure(503, "Account proxy is unavailable");
    if (active >= 2) throw failure(503, "Transcription capacity reached");
    active++; slot = true;
    signal.throwIfAborted();
    const audio = await convertAudio(file, signal);
    const boundary = `----9router-codex-${randomUUID()}`;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`),
      Buffer.from(await audio.arrayBuffer()), Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const response = await proxyAwareFetch(codex.sttConfig.baseUrl, {
      method: "POST", redirect: "error", signal, body,
      strictTls: true, directFetch: codexHttpFetch,
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`, "ChatGPT-Account-Id": accountId,
        "User-Agent": codex.transport.headers["User-Agent"],
        "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": String(body.length),
      },
    }, proxyOptions);
    if (!response.ok) {
      await response.body?.cancel();
      return createErrorResult(response.status >= 400 && response.status <= 599 ? response.status : 502, "Codex transcription failed");
    }
    const bytes = await readBounded(response.body, 1024 * 1024, signal, 502);
    let data;
    try { data = JSON.parse(bytes.toString("utf8")); } catch { throw failure(502, "Invalid transcription response"); }
    if (typeof data?.text !== "string" || data.text.length > 250000) throw failure(502, "Invalid transcription response");
    return { success: true, response: format === "text"
      ? new Response(data.text, { headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" } })
      : Response.json({ text: data.text }, { headers: cors }) };
  } catch (error) {
    return createErrorResult(error.status || (signal.aborted ? 504 : 502), error.status ? error.message : "Codex transcription failed");
  } finally {
    if (slot) active--;
  }
}
