// REAL survey: send PDF/DOCX as base64 to every active provider, using the file/document
// shape NATIVE to each provider's format (claude=document, gemini=inlineData, openai=file).
// Purpose: discover which providers actually accept inline base64 documents and how they
// reject DOCX. Survey-only: logs a grouped table, never asserts on accept/reject outcome.
//
//   RUN_REAL=1 npx vitest run --config tests/vitest.config.js tests/translator/real/file-base64-survey.real.test.js
import { describe, it, expect, afterAll } from "vitest";
import { getProviderCredentials } from "../../../src/sse/services/auth.js";
import { checkAndRefreshToken } from "../../../src/sse/services/tokenRefresh.js";
import { handleChatCore } from "../../../open-sse/handlers/chatCore.js";
import { getModelsByProviderId } from "../../../open-sse/config/providerModels.js";
import { getTargetFormat } from "../../../open-sse/services/provider.js";

const RUN_REAL = process.env.RUN_REAL === "1";
const TIMEOUT_MS = 90000;
const CRED_ISSUE = [401, 402, 403, 429];
const CRED_MSG_RE = /subscription|unauthorized|invalid api key|invalid access token|insufficient|credits|payment|spending|organization policy|disallowed|quota|exhausted|not supported when using|not available for integrator|requires a subscription|model.*not found|does not exist|not yet known|requires a role|invalid model id/i;
const NON_CHAT_KINDS = new Set(["embedding", "image", "imageToText", "tts", "stt", "video", "music", "webSearch"]);

const PROVIDER_FILTER = (process.env.REAL_PROVIDERS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

const PDF_B64 = "JVBERi0xLjEKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgMjAwIDIwMF0+PmVuZG9iagp4cmVmCjAgNAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1MiAwMDAwMCBuIAowMDAwMDAwMTAxIDAwMDAwIG4gCnRyYWlsZXI8PC9TaXplIDQvUm9vdCAxIDAgUj4+CnN0YXJ0eHJlZgoxNjYKJSVFT0Y=";
const DOCX_B64 = "UEsDBBQAAAAIAMZiz1yRzx8FvQAAACkBAAATABwAW0NvbnRlbnRfVHlwZXNdLnhtbFVUCQADA4wvagOML2p1eAsAAQT1AQAABAAAAAB9kL0OwjAMhF8lyoqoCwMDassArMDAC1ipWyKaHyXm7+1xATEwMNrf3fnkanV3g7pSyjb4Ws+KUq+a6viIlJUQn2t9Yo5LgGxO5DAXIZIX0oXkkGVMPUQ0Z+wJ5mW5ABM8k+cpjxm6qTbU4WVgtb3L+n1F7Fqt37rxVK0xxsEaZMEwUmiqvZRKtiV1wMQ7dKKCW0gttMFcnDiL/zFX3/50nYaus4a+/jEtpmAoZ+t7NxRf4tD6yacHvJ7RPAFQSwMECgAAAAAAxmLPXAAAAAAAAAAAAAAAAAUAHAB3b3JkL1VUCQADA4wvagOML2p1eAsAAQT1AQAABAAAAABQSwMEFAAAAAgAxmLPXD1WbTiKAAAAwAAAABEAHAB3b3JkL2RvY3VtZW50LnhtbFVUCQADA4wvagOML2p1eAsAAQT1AQAABAAAAABFjtEOgjAMRX9l2QdQ9MEHMuDV30BWgWRbl7aK/r0bxvhymuakt9eNrxjME1k2Sr09Na0dB7d3nuZHxKSm6CTd3ttVNXcAMq8YJ2koYyruThwnLSsvsBP7zDSjyJaWGODctheI05ZsjbyRf9eZK7hChyuGQKYcBm8URc3vr4OqK/lgPviNgH+94QNQSwECHgMUAAAACADGYs9ckc8fBb0AAAApAQAAEwAYAAAAAAABAAAApIEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFVUBQADA4wvanV4CwABBPUBAAAEAAAAAFBLAQIeAwoAAAAAAMZiz1wAAAAAAAAAAAAAAAAFABgAAAAAAAAAEADtQQoBAAB3b3JkL1VUBQADA4wvanV4CwABBPUBAAAEAAAAAFBLAQIeAxQAAAAIAMZiz1w9Vm04igAAAMAAAAARABgAAAAAAAEAAACkgUkBAAB3b3JkL2RvY3VtZW50LnhtbFVUBQADA4wvanV4CwABBPUBAAAEAAAAAFBLBQYAAAAAAwADAPsAAAAeAgAAAAA=";

const PDF_MIME = "application/pdf";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Build a native-format request body carrying one base64 document.
// fmt = provider target format; returns { sourceFormat, body } or null if format unsupported here.
function buildFileBody(fmt, mime, b64) {
  const ask = "Summarize this document in one word.";
  if (fmt === "claude") {
    return { sourceFormat: "claude", body: {
      max_tokens: 64, stream: true,
      messages: [{ role: "user", content: [
        { type: "text", text: ask },
        { type: "document", source: { type: "base64", media_type: mime, data: b64 } },
      ] }],
    } };
  }
  if (fmt === "gemini" || fmt === "gemini-cli" || fmt === "antigravity") {
    const gem = {
      contents: [{ role: "user", parts: [
        { text: ask },
        { inlineData: { mimeType: mime, data: b64 } },
      ] }],
      generationConfig: { maxOutputTokens: 64 },
    };
    return fmt === "antigravity"
      ? { sourceFormat: "antigravity", body: { request: gem, userAgent: "antigravity" } }
      : { sourceFormat: fmt, body: gem };
  }
  // openai + openai-compat: Chat Completions file block (file_data data URI).
  return { sourceFormat: "openai", body: {
    max_tokens: 64, stream: true,
    messages: [{ role: "user", content: [
      { type: "text", text: ask },
      { type: "file", file: { filename: `doc.${mime === PDF_MIME ? "pdf" : "docx"}`, file_data: `data:${mime};base64,${b64}` } },
    ] }],
  } };
}

const results = [];

async function drainSSE(response) {
  if (!response?.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

function chatModels(providerId) {
  return getModelsByProviderId(providerId).filter((m) => !NON_CHAT_KINDS.has(m.kind || m.type || "llm"));
}

function targetProviders() {
  try {
    const Database = require("better-sqlite3");
    const os = require("os");
    const path = require("path");
    const dbPath = process.env.DATA_DIR
      ? path.join(process.env.DATA_DIR, "db", "data.sqlite")
      : path.join(os.homedir(), ".9router", "db", "data.sqlite");
    const db = new Database(dbPath, { readonly: true });
    const rows = db.prepare("SELECT DISTINCT provider FROM providerConnections WHERE isActive = 1").all();
    db.close();
    let list = rows.map((r) => r.provider).sort();
    if (PROVIDER_FILTER.length) list = list.filter((p) => PROVIDER_FILTER.includes(p));
    return list;
  } catch {
    return [];
  }
}

// One model per provider is enough to learn provider-level document support (saves quota).
const FILE_TYPES = [["pdf", PDF_MIME, PDF_B64], ["docx", DOCX_MIME, DOCX_B64]];

describe.skipIf(!RUN_REAL)("REAL file base64 survey", () => {
  const providers = RUN_REAL ? targetProviders() : [];

  it("has active providers in DB", () => {
    expect(providers.length).toBeGreaterThan(0);
  });

  for (const providerId of providers) {
    const model = (RUN_REAL ? chatModels(providerId)[0]?.id : null);
    if (!model) continue;
    for (const [kind, mime, b64] of FILE_TYPES) {
      it.concurrent(`${kind} | ${providerId} / ${model}`, async () => {
        const fmt = getTargetFormat(providerId);
        const { sourceFormat, body } = buildFileBody(fmt, mime, b64);

        const credentials = await getProviderCredentials(providerId, new Set(), model);
        if (!credentials || credentials.allRateLimited) {
          results.push({ kind, providerId, model, fmt, status: "no-cred", verdict: "skip" });
          return expect(true).toBe(true);
        }
        const refreshed = await checkAndRefreshToken(providerId, credentials);

        const result = await handleChatCore({
          body: { ...body, model: `${providerId}/${model}` },
          modelInfo: { provider: providerId, model },
          credentials: refreshed,
          connectionId: credentials.connectionId,
          sourceFormatOverride: sourceFormat,
        });

        const status = Number(result.status) || (result.success ? 200 : 0);
        const errMsg = result.success ? "" : String(result.error || "");
        const credIssue = CRED_ISSUE.includes(status) || CRED_MSG_RE.test(errMsg);
        const ok = result.success;

        let verdict;
        if (credIssue) verdict = "skip-cred";
        else if (ok) verdict = `ok-${kind}`;
        else verdict = `reject-${kind}`;

        if (ok) await drainSSE(result.response).catch(() => {});
        results.push({ kind, providerId, model, fmt, status, verdict, error: ok ? "" : errMsg.slice(0, 90) });
        return expect(true).toBe(true);
      }, TIMEOUT_MS);
    }
  }

  afterAll(() => {
    const w = (s) => process.stdout.write(s + "\n");
    if (!results.length) { w("[file-survey] no results collected"); return; }
    const rank = (v) => (v.startsWith("ok") ? 0 : v.startsWith("reject") ? 1 : 2);
    const groups = [...new Set(results.map((r) => r.verdict))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    w("\n================ FILE BASE64 SURVEY ================");
    for (const g of groups) {
      const rows = results.filter((r) => r.verdict === g);
      if (!rows.length) continue;
      w(`\n### ${g} (${rows.length})`);
      for (const r of rows) {
        w(`  [${r.status}] ${r.kind} ${r.providerId}/${r.model} fmt=${r.fmt}${r.error ? ` :: ${r.error}` : ""}`);
      }
    }
    w("\n================ END SURVEY ================\n");
  });
});
