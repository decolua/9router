import { NextResponse } from "next/server";
import { DATA_DIR } from "@/lib/dataDir.js";
import { createProviderConnection, getProviderConnections, getProviderNodes } from "@/lib/localDb";
import { AI_PROVIDERS, getProviderByAlias } from "@/shared/constants/providers";

export const dynamic = "force-dynamic";

const SECRET_FIELDS = ["apiKey", "accessToken", "refreshToken", "idToken"];

function maskSecret(value) {
  if (!value || typeof value !== "string") return null;
  if (value.length <= 12) return `${value.slice(0, 3)}...${value.slice(-2)}`;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function getProviderLabel(provider, nodeNameMap) {
  return nodeNameMap[provider]
    || getProviderByAlias(provider)?.name
    || AI_PROVIDERS[provider]?.name
    || provider;
}

function getProblem(connection) {
  const status = connection.testStatus || "unknown";
  if (["error", "expired", "unavailable"].includes(status)) return status;
  if (connection.lastError) return "lastError";
  return null;
}

function camelToSnake(value) {
  return String(value).replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function compactObject(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined && value !== null)
  );
}

function snakeCaseProviderData(providerData = {}) {
  return Object.fromEntries(
    Object.entries(providerData)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [camelToSnake(key), value])
  );
}

function snakeToCamel(value) {
  return String(value).replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["true", "1", "yes", "on"].includes(value.toLowerCase());
  return fallback;
}

function normalizeImportedConnection(input) {
  const type = String(input?.type || input?.provider || "").trim().toLowerCase();
  if (!type) throw new Error("Missing `type` in imported JSON");

  const reserved = new Set([
    "access_token", "api_key", "disabled", "email", "expires_at", "expired", "id_token",
    "last_refresh", "refresh_token", "scope", "token_type", "type", "account_id",
  ]);

  const providerSpecificData = Object.fromEntries(
    Object.entries(input)
      .filter(([key, value]) => !reserved.has(key) && value !== undefined && value !== null)
      .map(([key, value]) => [snakeToCamel(key), value])
  );

  if (type === "codex" && input.account_id) providerSpecificData.chatgptAccountId = input.account_id;

  return compactObject({
    provider: type,
    authType: input.api_key ? "apikey" : "oauth",
    name: input.email || `${type}-imported`,
    email: input.email || null,
    accessToken: input.access_token,
    refreshToken: input.refresh_token,
    idToken: input.id_token,
    apiKey: input.api_key,
    expiresAt: input.expires_at || input.expired || null,
    tokenType: input.token_type,
    scope: input.scope,
    isActive: !parseBoolean(input.disabled, false),
    testStatus: input.access_token || input.api_key || input.refresh_token ? "active" : "unknown",
    providerSpecificData,
  });
}

function buildBaseTokenExportJson(connection) {
  const providerData = connection.providerSpecificData || {};

  return compactObject({
    access_token: connection.accessToken,
    api_key: connection.apiKey,
    disabled: connection.isActive === false,
    email: connection.email || null,
    expires_at: connection.expiresAt || null,
    id_token: connection.idToken,
    last_refresh: connection.updatedAt || null,
    refresh_token: connection.refreshToken,
    scope: connection.scope,
    token_type: connection.tokenType,
    ...snakeCaseProviderData(providerData),
    type: connection.provider,
  });
}

function buildCodexExportJson(connection, jwtMeta) {
  const providerData = connection.providerSpecificData || {};
  const accountId = jwtMeta?.accountId || providerData.chatgptAccountId || null;
  const email = connection.email || jwtMeta?.email || null;

  return compactObject({
    ...buildBaseTokenExportJson(connection),
    account_id: accountId,
    email,
    expired: connection.expiresAt || jwtMeta?.expiresAt || null,
    type: "codex",
  });
}

function buildKiroExportJson(connection) {
  const providerData = connection.providerSpecificData || {};

  return compactObject({
    ...buildBaseTokenExportJson(connection),
    auth_method: providerData.authMethod || null,
    client_id: providerData.clientId || null,
    client_secret: providerData.clientSecret || null,
    profile_arn: providerData.profileArn || "",
    provider: providerData.provider || "AWS",
    region: providerData.region || "us-east-1",
    start_url: providerData.startUrl || "https://view.awsapps.com/start",
    type: "kiro",
  });
}

function buildExportJson(connection, jwtMeta) {
  if (connection.provider === "codex") return buildCodexExportJson(connection, jwtMeta);
  if (connection.provider === "kiro") return buildKiroExportJson(connection);

  return buildBaseTokenExportJson(connection);
}

function decodeJwtPayload(token) {
  if (!token || typeof token !== "string") return null;
  const [, payload] = token.split(".");
  if (!payload) return null;

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function getJwtMeta(connection) {
  if (connection.provider !== "codex") return null;

  const payload = decodeJwtPayload(connection.accessToken);
  if (!payload) return null;

  const openAiAuth = payload["https://api.openai.com/auth"] || {};
  const openAiProfile = payload["https://api.openai.com/profile"] || {};
  const expMs = typeof payload.exp === "number" ? payload.exp * 1000 : null;

  return {
    email: openAiProfile.email || null,
    emailVerified: openAiProfile.email_verified ?? null,
    planType: openAiAuth.chatgpt_plan_type || null,
    accountId: openAiAuth.chatgpt_account_id || null,
    userId: openAiAuth.chatgpt_user_id || openAiAuth.user_id || null,
    subject: payload.sub || null,
    sessionId: payload.session_id || null,
    issuer: payload.iss || null,
    expiresAt: expMs ? new Date(expMs).toISOString() : null,
    expiresInSeconds: expMs ? Math.max(0, Math.floor((expMs - Date.now()) / 1000)) : null,
    isExpired: expMs ? expMs <= Date.now() : null,
    scopes: Array.isArray(payload.scp) ? payload.scp : [],
  };
}

export async function GET() {
  try {
    const [connections, nodes] = await Promise.all([
      getProviderConnections(),
      getProviderNodes().catch(() => []),
    ]);

    const nodeNameMap = Object.fromEntries((nodes || []).map((node) => [node.id, node.name]));
    const files = (connections || []).map((connection, index) => {
      const secrets = SECRET_FIELDS
        .filter((field) => connection[field])
        .map((field) => ({
          field,
          present: true,
          preview: maskSecret(connection[field]),
          value: String(connection[field]),
          length: String(connection[field]).length,
        }));

      const providerLabel = getProviderLabel(connection.provider, nodeNameMap);
      const problem = getProblem(connection);
      const jwtMeta = getJwtMeta(connection);

      return {
        id: connection.id,
        index: index + 1,
        filename: `${connection.provider}-${connection.name || connection.email || connection.id}.json`,
        provider: connection.provider,
        providerLabel,
        authType: connection.authType || "unknown",
        name: connection.name || connection.email || `Account ${index + 1}`,
        email: connection.email || null,
        isActive: connection.isActive !== false,
        priority: connection.priority || 999,
        testStatus: connection.testStatus || "unknown",
        lastError: connection.lastError || null,
        lastErrorAt: connection.lastErrorAt || null,
        createdAt: connection.createdAt || null,
        updatedAt: connection.updatedAt || null,
        expiresAt: connection.expiresAt || null,
        providerSpecificKeys: Object.keys(connection.providerSpecificData || {}),
        jwtMeta,
        secrets,
        secretCount: secrets.length,
        exportJson: buildExportJson(connection, jwtMeta),
        problem,
      };
    });

    return NextResponse.json({
      dataPath: `${DATA_DIR}/db.json`,
      total: files.length,
      files,
    });
  } catch (error) {
    console.error("[auth-files] failed to map db credentials:", error);
    return NextResponse.json({ error: "Failed to read auth files" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const items = Array.isArray(body) ? body : Array.isArray(body?.files) ? body.files : [body];
    const imported = [];

    for (const item of items) {
      const connection = normalizeImportedConnection(item);
      imported.push(await createProviderConnection(connection));
    }

    return NextResponse.json({ ok: true, imported: imported.length, connections: imported });
  } catch (error) {
    console.error("[auth-files] failed to import auth file:", error);
    return NextResponse.json({ error: error.message || "Failed to import auth file" }, { status: 400 });
  }
}