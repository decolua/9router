import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.AG_PROXY_PORT || 8788);
const HOST = process.env.AG_PROXY_HOST || "127.0.0.1";
const DATA_DIR = process.env.AG_PROXY_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), ".data");
const STORE_PATH = path.join(DATA_DIR, "accounts.enc.json");
const REDIRECT_URI = process.env.AG_PROXY_REDIRECT_URI || `http://${HOST}:${PORT}/auth/callback`;
const API_KEY = process.env.AG_PROXY_API_KEY || "";
const MASTER_KEY = process.env.AG_PROXY_MASTER_KEY || "";
const CLIENT_ID = process.env.AG_OAUTH_CLIENT_ID || "";
const CLIENT_SECRET = process.env.AG_OAUTH_CLIENT_SECRET || "";
const AUTHORIZE_URL = process.env.AG_OAUTH_AUTHORIZE_URL || "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = process.env.AG_OAUTH_TOKEN_URL || "https://oauth2.googleapis.com/token";
const USER_INFO_URL = process.env.AG_OAUTH_USERINFO_URL || "https://www.googleapis.com/oauth2/v1/userinfo?alt=json";
const CLOUD_CODE_URL = process.env.AG_CLOUD_CODE_URL || "https://cloudcode-pa.googleapis.com";
const DEFAULT_MODELS = (process.env.AG_PROXY_MODELS || "gemini-3-flash-agent,gemini-pro-agent,claude-sonnet-4-6").split(",").map(v => v.trim()).filter(Boolean);
const DEFAULT_STRATEGY = process.env.AG_PROXY_ROUTING_STRATEGY === "priority" ? "priority" : "round-robin";
const SCOPES = (process.env.AG_OAUTH_SCOPES || ["https://www.googleapis.com/auth/cloud-platform", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile", "https://www.googleapis.com/auth/cclog", "https://www.googleapis.com/auth/experimentsandconfigs"].join(" ")).trim();
const REFRESH_AHEAD_MS = 5 * 60 * 1000;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_COOLDOWN_MS = Math.max(1_000, Number(process.env.AG_PROXY_COOLDOWN_MS || 60_000));
const MAX_COOLDOWN_MS = Math.max(DEFAULT_COOLDOWN_MS, Number(process.env.AG_PROXY_MAX_COOLDOWN_MS || 60 * 60 * 1000));
const states = new Map();
const refreshLocks = new Map();
let mutationTail = Promise.resolve();

function fail(message, status = 500, extra = {}) { return Object.assign(new Error(message), { status, ...extra }); }
function nowIso() { return new Date().toISOString(); }
function isLocal() { return HOST === "127.0.0.1" || HOST === "localhost" || HOST === "::1"; }
function oauthMetadata() { return { ideType: 9, platform: 3, pluginType: 2 }; }
function keyFor(salt) { return crypto.scryptSync(MASTER_KEY, salt, 32); }
function configured() {
  const missing = [[MASTER_KEY, "AG_PROXY_MASTER_KEY"], [CLIENT_ID, "AG_OAUTH_CLIENT_ID"], [CLIENT_SECRET, "AG_OAUTH_CLIENT_SECRET"]].filter(([value]) => !value).map(([, name]) => name);
  if (missing.length) throw fail(`Missing required configuration: ${missing.join(", ")}`);
}
function defaultStore() { return { version: 2, settings: { strategy: DEFAULT_STRATEGY }, accounts: [] }; }
function defaultMetrics() { return { requests: 0, successes: 0, failures: 0, lastUsedAt: null, lastSuccessAt: null, lastErrorAt: null, lastError: null }; }
function normalizeAccount(raw) {
  return { id: raw.id || crypto.randomUUID(), name: raw.name || raw.email || "Account", email: raw.email || null, accessToken: raw.accessToken || "", refreshToken: raw.refreshToken || "", expiresAt: raw.expiresAt || null, projectId: raw.projectId || "", updatedAt: raw.updatedAt || nowIso(), enabled: raw.enabled !== false, priority: Math.max(1, Number(raw.priority) || 1), allowedModels: Array.isArray(raw.allowedModels) ? [...new Set(raw.allowedModels.filter(Boolean))] : [], availableModels: Array.isArray(raw.availableModels) ? raw.availableModels : [], modelLocks: raw.modelLocks && typeof raw.modelLocks === "object" ? raw.modelLocks : {}, metrics: { ...defaultMetrics(), ...(raw.metrics || {}) } };
}
function normalizeStore(value) {
  if (value?.version === 2 && Array.isArray(value.accounts)) return { version: 2, settings: { strategy: value.settings?.strategy === "priority" ? "priority" : "round-robin" }, accounts: value.accounts.map(normalizeAccount) };
  if (value?.accessToken || value?.refreshToken) return { version: 2, settings: { strategy: DEFAULT_STRATEGY }, accounts: [normalizeAccount(value)] };
  return defaultStore();
}
async function saveStore(store) {
  if (!MASTER_KEY) throw fail("AG_PROXY_MASTER_KEY is required before storing credentials");
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyFor(salt), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(normalizeStore(store)), "utf8"), cipher.final()]);
  const payload = { version: 2, salt: salt.toString("base64url"), iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), ciphertext: ciphertext.toString("base64url") };
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  const temp = `${STORE_PATH}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(payload), { mode: 0o600 });
  await fs.rename(temp, STORE_PATH);
}
async function loadStore() {
  try {
    const payload = JSON.parse(await fs.readFile(STORE_PATH, "utf8"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", keyFor(Buffer.from(payload.salt, "base64url")), Buffer.from(payload.iv, "base64url"));
    decipher.setAuthTag(Buffer.from(payload.tag, "base64url"));
    return normalizeStore(JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, "base64url")), decipher.final()]).toString("utf8")));
  } catch (error) { if (error?.code === "ENOENT") return defaultStore(); throw fail("Cannot decrypt the local account store. Check AG_PROXY_MASTER_KEY."); }
}
async function mutateStore(fn) {
  const previous = mutationTail;
  let release;
  mutationTail = new Promise(resolve => { release = resolve; });
  await previous;
  try { const store = await loadStore(); const result = await fn(store); await saveStore(store); return result; } finally { release(); }
}
function json(res, status, body) { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(body)); }
function html(res, status, body) { res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }); res.end(body); }
async function readJson(req) { const chunks = []; for await (const chunk of req) chunks.push(chunk); try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw fail("Request body must be valid JSON", 400); } }
function authorized(req) { if (!API_KEY) return isLocal(); const actual = Buffer.from(req.headers.authorization || ""); const expected = Buffer.from(`Bearer ${API_KEY}`); return actual.length === expected.length && crypto.timingSafeEqual(actual, expected); }
function requireApi(req) { if (!authorized(req)) throw fail("Unauthorized", 401, { type: "authentication_error" }); }
function listFrom(value) { return Array.isArray(value) ? [...new Set(value.filter(v => typeof v === "string" && v.trim()).map(v => v.trim()))] : []; }
function tokenState(account) { const expiresAtMs = account.expiresAt ? new Date(account.expiresAt).getTime() : 0; if (!expiresAtMs || expiresAtMs <= Date.now()) return "expired"; if (expiresAtMs - Date.now() <= REFRESH_AHEAD_MS) return "refresh_due"; return "active"; }
function activeLocks(account) { const now = Date.now(); return Object.fromEntries(Object.entries(account.modelLocks || {}).filter(([, lock]) => new Date(lock.until).getTime() > now).map(([model, lock]) => [model, { until: lock.until, status: lock.status, lastError: lock.lastError }])); }
function safeAccount(account) { return { id: account.id, name: account.name, email: account.email, enabled: account.enabled, priority: account.priority, allowedModels: account.allowedModels, availableModels: account.availableModels, projectId: account.projectId || null, expiresAt: account.expiresAt, tokenState: tokenState(account), refreshDueAt: account.expiresAt ? new Date(new Date(account.expiresAt).getTime() - REFRESH_AHEAD_MS).toISOString() : null, updatedAt: account.updatedAt, modelLocks: activeLocks(account), metrics: account.metrics }; }
function cloudHeaders(token) { return { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": process.env.AG_UPSTREAM_USER_AGENT || "ag-oauth-proxy/0.2" }; }
async function fetchProjectId(token) { const res = await fetch(`${CLOUD_CODE_URL}/v1internal:loadCodeAssist`, { method: "POST", headers: cloudHeaders(token), body: JSON.stringify({ metadata: oauthMetadata() }) }); if (!res.ok) throw fail(`Code Assist project lookup failed (${res.status})`, 502); const body = await res.json(); const project = body.cloudaicompanionProject; return typeof project === "string" ? project : project?.id || ""; }
function parseModels(body) { const models = Array.isArray(body?.models) ? body.models : Object.entries(body?.models || {}).map(([id, item]) => ({ id, ...item })); return models.map(item => ({ id: item?.id || item?.model || item?.name, name: item?.displayName || item?.name || item?.id || item?.model })).filter(item => item.id && !item.isInternal); }
async function fetchAvailableModels(account) { const res = await fetch(`${CLOUD_CODE_URL}/v1internal:fetchAvailableModels`, { method: "POST", headers: cloudHeaders(account.accessToken), body: JSON.stringify({ ...(account.projectId ? { project: account.projectId } : {}) }) }); if (!res.ok) throw fail(`Model discovery failed (${res.status})`, 502); return parseModels(await res.json()); }
async function exchangeCode(code, verifier) { const res = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code, redirect_uri: REDIRECT_URI, code_verifier: verifier }) }); if (!res.ok) throw fail(`OAuth code exchange failed (${res.status})`, 400); return res.json(); }
async function refreshAccount(id, force = false) {
  if (refreshLocks.has(id)) return refreshLocks.get(id);
  const pending = mutateStore(async store => {
    const account = store.accounts.find(item => item.id === id);
    if (!account) throw fail("Account not found", 404);
    const expires = account.expiresAt ? new Date(account.expiresAt).getTime() : 0;
    if (!force && expires - Date.now() > REFRESH_AHEAD_MS) return account;
    const res = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams({ grant_type: "refresh_token", client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: account.refreshToken }) });
    if (!res.ok) { account.metrics.failures++; account.metrics.lastError = "OAuth refresh failed"; account.metrics.lastErrorAt = nowIso(); throw fail("OAuth refresh failed; reconnect this account through /auth/start", 401); }
    const token = await res.json();
    account.accessToken = token.access_token; account.refreshToken = token.refresh_token || account.refreshToken; account.expiresAt = new Date(Date.now() + Number(token.expires_in || 3600) * 1000).toISOString(); account.updatedAt = nowIso();
    account.projectId = await fetchProjectId(account.accessToken).catch(() => account.projectId || "");
    return account;
  }).finally(() => refreshLocks.delete(id));
  refreshLocks.set(id, pending); return pending;
}
function isLocked(account, model) { const lock = account.modelLocks?.[model] || account.modelLocks?.["*"]; return lock && new Date(lock.until).getTime() > Date.now() ? lock : null; }
function supportsModel(account, model) { return account.allowedModels.length === 0 || account.allowedModels.includes(model); }
function chooseAccount(store, model, excluded) {
  const candidates = store.accounts.filter(account => account.enabled && supportsModel(account, model) && !excluded.has(account.id) && !isLocked(account, model));
  if (!candidates.length) {
    const waits = store.accounts.filter(account => account.enabled && supportsModel(account, model) && !excluded.has(account.id)).map(account => isLocked(account, model)).filter(Boolean).map(lock => new Date(lock.until).getTime()).filter(Number.isFinite);
    throw fail(waits.length ? "All eligible accounts are temporarily unavailable" : "No enabled account is assigned to this model", 503, { retryAfter: waits.length ? new Date(Math.min(...waits)).toISOString() : null });
  }
  const byPriority = (a, b) => a.priority - b.priority || a.id.localeCompare(b.id);
  if (store.settings.strategy === "priority") return [...candidates].sort(byPriority)[0];
  return [...candidates].sort((a, b) => new Date(a.metrics.lastUsedAt || 0) - new Date(b.metrics.lastUsedAt || 0) || byPriority(a, b))[0];
}
async function selectAccount(model, excluded) {
  const account = await mutateStore(store => { const chosen = chooseAccount(store, model, excluded); chosen.metrics.requests++; chosen.metrics.lastUsedAt = nowIso(); return { ...chosen }; });
  if (!account.expiresAt || new Date(account.expiresAt).getTime() - Date.now() < REFRESH_AHEAD_MS) return refreshAccount(account.id);
  if (!account.projectId) return mutateStore(async store => { const item = store.accounts.find(v => v.id === account.id); item.projectId = await fetchProjectId(item.accessToken); item.updatedAt = nowIso(); return { ...item }; });
  return account;
}
function retryAfterMs(headers, message) { const value = headers?.get?.("retry-after"); if (/^\d+$/.test(value || "")) return Math.min(MAX_COOLDOWN_MS, Number(value) * 1000); const match = String(message || "").match(/reset after (\d+h)?(\d+m)?(\d+s)?/i); if (!match) return DEFAULT_COOLDOWN_MS; const ms = (Number.parseInt(match[1]) || 0) * 3600000 + (Number.parseInt(match[2]) || 0) * 60000 + (Number.parseInt(match[3]) || 0) * 1000; return Math.min(MAX_COOLDOWN_MS, Math.max(DEFAULT_COOLDOWN_MS, ms)); }
async function recordSuccess(id) { return mutateStore(store => { const account = store.accounts.find(item => item.id === id); if (!account) return; account.metrics.successes++; account.metrics.lastSuccessAt = nowIso(); account.metrics.lastError = null; }); }
async function recordFailure(id, model, error) { return mutateStore(store => { const account = store.accounts.find(item => item.id === id); if (!account) return; account.metrics.failures++; account.metrics.lastErrorAt = nowIso(); account.metrics.lastError = error.message.slice(0, 200); if ([429, 500, 502, 503, 504].includes(error.upstreamStatus)) account.modelLocks[model] = { until: new Date(Date.now() + error.cooldownMs).toISOString(), status: error.upstreamStatus, lastError: error.message.slice(0, 200) }; }); }
function contentText(content) { if (typeof content === "string") return content; if (!Array.isArray(content)) return ""; return content.filter(part => part?.type === "text").map(part => part.text || "").join("\n"); }
function translateOpenAi(body, account) {
  if (!Array.isArray(body.messages) || !body.messages.length) throw fail("messages must be a non-empty array", 400);
  const contents = [], system = []; for (const message of body.messages) { const value = contentText(message.content); if (!value) continue; if (["system", "developer"].includes(message.role)) system.push(value); else contents.push({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: value }] }); }
  if (!contents.length) throw fail("messages must include user or assistant text", 400);
  const model = String(body.model || "").replace(/^antigravity\//, ""); if (!model) throw fail("model is required", 400);
  return { project: account.projectId, model, userAgent: "ag-oauth-proxy", requestType: "agent", requestId: `proxy/${crypto.randomUUID()}/${Date.now()}`, request: { ...(system.length ? { systemInstruction: { role: "system", parts: [{ text: system.join("\n\n") }] } } : {}), contents, generationConfig: { ...(Number.isFinite(body.temperature) ? { temperature: body.temperature } : {}), ...(Number.isFinite(body.max_tokens) ? { maxOutputTokens: body.max_tokens } : {}) }, sessionId: body.user || crypto.randomUUID() } };
}
function upstreamText(payload) { const candidate = payload?.response?.candidates?.[0] || payload?.candidates?.[0]; return (candidate?.content?.parts || []).map(part => part?.text || "").join(""); }
function openAiResponse(model, upstream) { const response = upstream?.response || upstream, usage = response?.usageMetadata || {}; return { id: `chatcmpl-${crypto.randomUUID()}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: `antigravity/${model}`, choices: [{ index: 0, message: { role: "assistant", content: upstreamText(upstream) }, finish_reason: "stop" }], usage: { prompt_tokens: usage.promptTokenCount || 0, completion_tokens: usage.candidatesTokenCount || 0, total_tokens: usage.totalTokenCount || 0 } }; }
async function callUpstream(payload, account, stream) { const action = stream ? "streamGenerateContent?alt=sse" : "generateContent"; const response = await fetch(`${CLOUD_CODE_URL}/v1internal:${action}`, { method: "POST", headers: cloudHeaders(account.accessToken), body: JSON.stringify(payload) }); if (!response.ok) { const message = (await response.text()).slice(0, 500) || `Upstream request failed (${response.status})`; throw fail(message, response.status === 401 ? 401 : 502, { upstreamStatus: response.status, cooldownMs: retryAfterMs(response.headers, message) }); } return response; }
async function streamResponse(res, upstream, model) { res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" }); const decoder = new TextDecoder(); let buffer = ""; for await (const chunk of upstream.body) { buffer += decoder.decode(chunk, { stream: true }); const events = buffer.split("\n\n"); buffer = events.pop() || ""; for (const event of events) { const data = event.split("\n").find(line => line.startsWith("data:"))?.slice(5).trim(); if (!data || data === "[DONE]") continue; try { const delta = upstreamText(JSON.parse(data)); if (delta) res.write(`data: ${JSON.stringify({ id: `chatcmpl-${crypto.randomUUID()}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: `antigravity/${model}`, choices: [{ index: 0, delta: { content: delta }, finish_reason: null }] })}\n\n`); } catch {} } } res.end("data: [DONE]\n\n"); }
async function handleChat(req, res) {
  const body = await readJson(req), model = String(body.model || "").replace(/^antigravity\//, ""); if (!model) throw fail("model is required", 400);
  const excluded = new Set(); let lastError;
  while (true) {
    let account;
    try { account = await selectAccount(model, excluded); const payload = translateOpenAi(body, account); const upstream = await callUpstream(payload, account, body.stream === true); if (body.stream) { await recordSuccess(account.id); return streamResponse(res, upstream, model); } const result = await upstream.json(); await recordSuccess(account.id); return json(res, 200, openAiResponse(model, result)); }
    catch (error) { if (account) { await recordFailure(account.id, model, error); if ([429, 500, 502, 503, 504].includes(error.upstreamStatus)) { excluded.add(account.id); lastError = error; continue; } } if (lastError && error.retryAfter) error.message = `${lastError.message}; ${error.message}`; throw error; }
  }
}
function pathId(pathname, suffix = "") { const prefix = "/admin/accounts/"; if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) return null; const value = pathname.slice(prefix.length, suffix ? -suffix.length : undefined); return value && !value.includes("/") ? value : null; }
async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true, service: "antigravity-oauth-proxy" });
  if (req.method === "GET" && url.pathname === "/auth/start") {
    configured(); if (!isLocal()) requireApi(req);
    const state = crypto.randomBytes(32).toString("base64url"), verifier = crypto.randomBytes(48).toString("base64url"), challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    states.set(state, { verifier, expiresAt: Date.now() + OAUTH_STATE_TTL_MS, assignment: { name: String(url.searchParams.get("name") || "").trim().slice(0, 80), priority: Math.max(1, Number(url.searchParams.get("priority")) || 1), allowedModels: listFrom((url.searchParams.get("models") || "").split(",")) } });
    const authUrl = new URL(AUTHORIZE_URL); authUrl.search = new URLSearchParams({ client_id: CLIENT_ID, response_type: "code", redirect_uri: REDIRECT_URI, scope: SCOPES, state, access_type: "offline", prompt: "consent", code_challenge: challenge, code_challenge_method: "S256" }).toString(); res.writeHead(302, { Location: authUrl.toString(), "Cache-Control": "no-store" }); return res.end();
  }
  if (req.method === "GET" && url.pathname === "/auth/callback") {
    const state = url.searchParams.get("state"), code = url.searchParams.get("code"), pending = state && states.get(state); states.delete(state); if (!pending || pending.expiresAt < Date.now() || !code) throw fail("Invalid, expired, or incomplete OAuth callback", 400);
    const tokens = await exchangeCode(code, pending.verifier); const info = await fetch(USER_INFO_URL, { headers: { Authorization: `Bearer ${tokens.access_token}` } }).then(r => r.ok ? r.json() : {}); const projectId = await fetchProjectId(tokens.access_token);
    const account = await mutateStore(store => { const existing = store.accounts.find(item => item.email && info.email && item.email === info.email); const next = normalizeAccount({ ...(existing || {}), id: existing?.id || crypto.randomUUID(), name: pending.assignment.name || existing?.name || info.email || "Account", email: info.email || existing?.email || null, accessToken: tokens.access_token, refreshToken: tokens.refresh_token || existing?.refreshToken, expiresAt: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString(), projectId, enabled: true, priority: pending.assignment.priority || existing?.priority || 1, allowedModels: pending.assignment.allowedModels.length ? pending.assignment.allowedModels : existing?.allowedModels || [], updatedAt: nowIso() }); if (existing) Object.assign(existing, next); else store.accounts.push(next); return safeAccount(next); });
    return html(res, 200, `<h1>Account connected</h1><p>${account.name.replace(/[<>&"]/g, "")}</p><p>You may close this page.</p>`);
  }
  requireApi(req);
  if (req.method === "GET" && url.pathname === "/admin/accounts") { const store = await loadStore(); return json(res, 200, { accounts: store.accounts.map(safeAccount) }); }
  if (req.method === "GET" && url.pathname === "/admin/status") { const store = await loadStore(); return json(res, 200, { strategy: store.settings.strategy, accounts: store.accounts.map(safeAccount), totals: store.accounts.reduce((sum, account) => ({ requests: sum.requests + account.metrics.requests, successes: sum.successes + account.metrics.successes, failures: sum.failures + account.metrics.failures }), { requests: 0, successes: 0, failures: 0 }) }); }
  if (req.method === "GET" && url.pathname === "/admin/settings") { const store = await loadStore(); return json(res, 200, store.settings); }
  if (req.method === "PATCH" && url.pathname === "/admin/settings") { const body = await readJson(req); if (!["round-robin", "priority"].includes(body.strategy)) throw fail("strategy must be round-robin or priority", 400); const settings = await mutateStore(store => { store.settings.strategy = body.strategy; return store.settings; }); return json(res, 200, settings); }
  const refreshModelsId = pathId(url.pathname, "/models/refresh");
  if (req.method === "POST" && refreshModelsId) { const account = await refreshAccount(refreshModelsId); const models = await fetchAvailableModels(account); const output = await mutateStore(store => { const item = store.accounts.find(v => v.id === refreshModelsId); item.availableModels = models; item.updatedAt = nowIso(); return safeAccount(item); }); return json(res, 200, { account: output, models }); }
  const accountId = pathId(url.pathname);
  if (accountId && req.method === "PATCH") { const body = await readJson(req); const account = await mutateStore(store => { const item = store.accounts.find(v => v.id === accountId); if (!item) throw fail("Account not found", 404); if (typeof body.name === "string") item.name = body.name.trim().slice(0, 80) || item.name; if (typeof body.enabled === "boolean") item.enabled = body.enabled; if (body.priority !== undefined) item.priority = Math.max(1, Number(body.priority) || 1); if (body.allowedModels !== undefined) item.allowedModels = listFrom(body.allowedModels); item.updatedAt = nowIso(); return safeAccount(item); }); return json(res, 200, { account }); }
  if (accountId && req.method === "DELETE") { await mutateStore(store => { const index = store.accounts.findIndex(v => v.id === accountId); if (index < 0) throw fail("Account not found", 404); store.accounts.splice(index, 1); }); return json(res, 200, { deleted: true }); }
  if (req.method === "GET" && url.pathname === "/v1/models") { const store = await loadStore(); const modelIds = new Set(); for (const account of store.accounts.filter(item => item.enabled)) { const known = account.availableModels.length ? account.availableModels.map(item => item.id) : DEFAULT_MODELS; for (const model of account.allowedModels.length ? account.allowedModels : known) modelIds.add(model); } return json(res, 200, { object: "list", data: [...modelIds].sort().map(id => ({ id: `antigravity/${id}`, object: "model", owned_by: "antigravity" })) }); }
  if (req.method === "POST" && url.pathname === "/v1/chat/completions") return handleChat(req, res);
  throw fail("Not found", 404, { type: "invalid_request_error" });
}
setInterval(() => { for (const [state, pending] of states) if (pending.expiresAt < Date.now()) states.delete(state); }, OAUTH_STATE_TTL_MS).unref();
const server = http.createServer((req, res) => handler(req, res).catch(error => json(res, error.status || 500, { error: { message: error.message || "Internal server error", type: error.type || "proxy_error", ...(error.retryAfter ? { retry_after: error.retryAfter } : {}) } })));
server.listen(PORT, HOST, () => console.log(`Antigravity OAuth proxy listening at http://${HOST}:${PORT}`));
