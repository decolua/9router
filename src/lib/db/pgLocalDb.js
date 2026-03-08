/**
 * PostgreSQL implementation of localDb API.
 * Used when DATABASE_URL is set. All functions mirror localDb.js signatures.
 */
import { getPool } from "./postgres.js";
import { v4 as uuidv4 } from "uuid";

function toCamel(str) {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
function rowToCamel(row) {
  if (!row) return null;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[toCamel(k)] = v;
  }
  return out;
}

const DEFAULT_SETTINGS = {
  cloudEnabled: false,
  tunnelEnabled: false,
  tunnelUrl: "",
  stickyRoundRobinLimit: 3,
  requireLogin: true,
  observabilityEnabled: true,
  observabilityMaxRecords: 1000,
  observabilityBatchSize: 20,
  observabilityFlushIntervalMs: 5000,
  observabilityMaxJsonSize: 1024,
  outboundProxyEnabled: false,
  outboundProxyUrl: "",
  outboundNoProxy: "",
  fallbackStrategy: "fill-first",
};

async function pool() {
  const p = await getPool();
  if (!p) throw new Error("PostgreSQL not configured (DATABASE_URL)");
  return p;
}

// ---------- Provider connections ----------
export async function getProviderConnections(filter = {}, userId = null) {
  const p = await pool();
  let q = "SELECT * FROM provider_connections WHERE 1=1";
  const params = [];
  let i = 1;
  if (userId) {
    q += ` AND user_id = $${i++}`;
    params.push(userId);
  }
  if (filter.provider) {
    q += ` AND provider = $${i++}`;
    params.push(filter.provider);
  }
  if (filter.isActive !== undefined) {
    q += ` AND is_active = $${i++}`;
    params.push(filter.isActive);
  }
  q += " ORDER BY priority ASC NULLS LAST, updated_at DESC";
  const res = await p.query(q, params);
  let list = res.rows.map(rowToCamel);
  return list;
}

export async function getProviderConnectionById(id, userId = null) {
  const p = await pool();
  const res = await p.query(
    "SELECT * FROM provider_connections WHERE id = $1",
    [id]
  );
  const row = res.rows[0];
  if (!row) return null;
  const c = rowToCamel(row);
  if (userId && c.userId && c.userId !== userId) return null;
  return c;
}

export async function createProviderConnection(data) {
  const p = await pool();
  const userId = data.userId ?? null;
  if (data.authType === "oauth" && data.email) {
    const ex = await p.query(
      "SELECT id FROM provider_connections WHERE provider = $1 AND auth_type = 'oauth' AND email = $2 AND (($3::uuid IS NULL AND user_id IS NULL) OR user_id = $3) LIMIT 1",
      [data.provider, data.email, userId]
    );
    if (ex.rows[0]) {
      return updateProviderConnection(
        ex.rows[0].id,
        { ...data, id: ex.rows[0].id },
        userId
      );
    }
  } else if (data.authType === "apikey" && data.name) {
    const ex = await p.query(
      "SELECT id FROM provider_connections WHERE provider = $1 AND auth_type = 'apikey' AND name = $2 AND (($3::uuid IS NULL AND user_id IS NULL) OR user_id = $3) LIMIT 1",
      [data.provider, data.name, userId]
    );
    if (ex.rows[0]) {
      return updateProviderConnection(
        ex.rows[0].id,
        { ...data, id: ex.rows[0].id },
        userId
      );
    }
  }
  const now = new Date();
  const id = data.id || uuidv4();
  const name =
    data.name ||
    (data.authType === "oauth" && data.email ? data.email : null) ||
    "Account 1";
  let priority = data.priority;
  if (priority == null) {
    const pr = await p.query(
      "SELECT COALESCE(MAX(priority), 0) + 1 AS next FROM provider_connections WHERE provider = $1",
      [data.provider]
    );
    priority = Number(pr.rows[0]?.next) || 1;
  }
  await p.query(
    `INSERT INTO provider_connections (
      id, user_id, provider, auth_type, name, email, display_name, priority, is_active,
      access_token, refresh_token, expires_at, token_type, scope, id_token, project_id, api_key,
      test_status, last_tested, last_error, last_error_at, rate_limited_until, expires_in, error_code,
      consecutive_use_count, global_priority, default_model, provider_specific_data, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30
    )`,
    [
      id,
      userId,
      data.provider,
      data.authType || "oauth",
      name,
      data.email ?? null,
      data.displayName ?? null,
      priority,
      data.isActive !== undefined ? data.isActive : true,
      data.accessToken ?? null,
      data.refreshToken ?? null,
      data.expiresAt ?? null,
      data.tokenType ?? null,
      data.scope ?? null,
      data.idToken ?? null,
      data.projectId ?? null,
      data.apiKey ?? null,
      data.testStatus ?? null,
      data.lastTested ?? null,
      data.lastError ?? null,
      data.lastErrorAt ?? null,
      data.rateLimitedUntil ?? null,
      data.expiresIn ?? null,
      data.errorCode ?? null,
      data.consecutiveUseCount ?? 0,
      data.globalPriority ?? null,
      data.defaultModel ?? null,
      data.providerSpecificData ? JSON.stringify(data.providerSpecificData) : null,
      now,
      now,
    ]
  );
  return getProviderConnectionById(id, userId);
}

export async function updateProviderConnection(id, data, userId = null) {
  const existing = await getProviderConnectionById(id, userId);
  if (!existing) return null;
  const p = await pool();
  const updates = [];
  const values = [];
  let i = 1;
  const map = {
    userId: "user_id",
    provider: "provider",
    authType: "auth_type",
    name: "name",
    email: "email",
    displayName: "display_name",
    priority: "priority",
    isActive: "is_active",
    accessToken: "access_token",
    refreshToken: "refresh_token",
    expiresAt: "expires_at",
    tokenType: "token_type",
    scope: "scope",
    idToken: "id_token",
    projectId: "project_id",
    apiKey: "api_key",
    testStatus: "test_status",
    lastTested: "last_tested",
    lastError: "last_error",
    lastErrorAt: "last_error_at",
    rateLimitedUntil: "rate_limited_until",
    expiresIn: "expires_in",
    errorCode: "error_code",
    consecutiveUseCount: "consecutive_use_count",
    globalPriority: "global_priority",
    defaultModel: "default_model",
    providerSpecificData: "provider_specific_data",
  };
  for (const [k, col] of Object.entries(map)) {
    if (data[k] !== undefined) {
      updates.push(`${col} = $${i++}`);
      values.push(
        k === "providerSpecificData" && data[k] != null
          ? JSON.stringify(data[k])
          : data[k]
      );
    }
  }
  if (updates.length === 0) return existing;
  updates.push(`updated_at = $${i++}`);
  values.push(new Date());
  values.push(id);
  await p.query(
    `UPDATE provider_connections SET ${updates.join(", ")} WHERE id = $${i}`,
    values
  );
  return getProviderConnectionById(id, userId);
}

export async function deleteProviderConnection(id, userId = null) {
  const existing = await getProviderConnectionById(id, userId);
  if (!existing) return false;
  const p = await pool();
  await p.query("DELETE FROM provider_connections WHERE id = $1", [id]);
  return true;
}

export async function reorderProviderConnections(providerId) {
  const p = await pool();
  const res = await p.query(
    "SELECT id, priority FROM provider_connections WHERE provider = $1 ORDER BY priority ASC NULLS LAST, updated_at DESC",
    [providerId]
  );
  for (let i = 0; i < res.rows.length; i++) {
    await p.query("UPDATE provider_connections SET priority = $1, updated_at = $2 WHERE id = $3", [
      i + 1,
      new Date(),
      res.rows[i].id,
    ]);
  }
}

export async function deleteProviderConnectionsByProvider(providerId) {
  const p = await pool();
  const res = await p.query("DELETE FROM provider_connections WHERE provider = $1", [
    providerId,
  ]);
  return res.rowCount || 0;
}

// ---------- Provider nodes ----------
export async function getProviderNodes(filter = {}) {
  const p = await pool();
  let q = "SELECT * FROM provider_nodes WHERE 1=1";
  const params = [];
  if (filter.type) {
    params.push(filter.type);
    q += ` AND type = $${params.length}`;
  }
  const res = await p.query(q, params);
  return res.rows.map(rowToCamel);
}

export async function getProviderNodeById(id) {
  const p = await pool();
  const res = await p.query("SELECT * FROM provider_nodes WHERE id = $1", [id]);
  return res.rows[0] ? rowToCamel(res.rows[0]) : null;
}

export async function createProviderNode(data) {
  const p = await pool();
  const id = data.id || uuidv4();
  const now = new Date();
  await p.query(
    `INSERT INTO provider_nodes (id, type, name, prefix, api_type, base_url, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      data.type,
      data.name,
      data.prefix ?? null,
      data.apiType ?? null,
      data.baseUrl ?? null,
      now,
      now,
    ]
  );
  return getProviderNodeById(id);
}

const PROVIDER_NODE_COLS = { type: "type", name: "name", prefix: "prefix", apiType: "api_type", baseUrl: "base_url" };
export async function updateProviderNode(id, data) {
  const p = await pool();
  const updates = [];
  const values = [];
  let i = 1;
  for (const [k, col] of Object.entries(PROVIDER_NODE_COLS)) {
    if (data[k] !== undefined) {
      updates.push(`${col} = $${i++}`);
      values.push(data[k]);
    }
  }
  if (updates.length === 0) return getProviderNodeById(id);
  updates.push(`updated_at = $${i++}`);
  values.push(new Date());
  values.push(id);
  await p.query(
    `UPDATE provider_nodes SET ${updates.join(", ")} WHERE id = $${i}`,
    values
  );
  return getProviderNodeById(id);
}

export async function deleteProviderNode(id) {
  const p = await pool();
  const res = await p.query("DELETE FROM provider_nodes WHERE id = $1 RETURNING *", [id]);
  return res.rows[0] ? rowToCamel(res.rows[0]) : null;
}

// ---------- Model aliases ----------
export async function getModelAliases(userId = null) {
  const p = await pool();
  let q = "SELECT alias, model FROM model_aliases WHERE 1=1";
  const params = [];
  if (userId) {
    q += " AND (user_id = $1 OR user_id IS NULL)";
    params.push(userId);
  }
  const res = await p.query(q, params);
  const result = {};
  for (const r of res.rows) {
    result[r.alias] = r.model;
  }
  return result;
}

export async function setModelAlias(alias, model, userId = null) {
  const p = await pool();
  if (userId == null) {
    await p.query("DELETE FROM model_aliases WHERE alias = $1 AND user_id IS NULL", [
      alias,
    ]);
    await p.query(
      "INSERT INTO model_aliases (id, user_id, alias, model, created_at) VALUES ($1, NULL, $2, $3, $4)",
      [uuidv4(), alias, model, new Date()]
    );
  } else {
    await p.query(
      `INSERT INTO model_aliases (id, user_id, alias, model, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, alias) DO UPDATE SET model = EXCLUDED.model`,
      [uuidv4(), userId, alias, model, new Date()]
    );
  }
}

export async function deleteModelAlias(alias, userId = null) {
  const p = await pool();
  if (userId != null) {
    await p.query("DELETE FROM model_aliases WHERE alias = $1 AND user_id = $2", [
      alias,
      userId,
    ]);
  } else {
    await p.query("DELETE FROM model_aliases WHERE alias = $1 AND user_id IS NULL", [
      alias,
    ]);
  }
}

// ---------- MITM alias ----------
export async function getMitmAlias(toolName) {
  const p = await pool();
  let q = "SELECT tool_name, mappings FROM mitm_alias";
  const params = [];
  if (toolName) {
    q += " WHERE tool_name = $1";
    params.push(toolName);
  }
  const res = await p.query(q, params);
  if (toolName) {
    const row = res.rows[0];
    return (row && row.mappings) || {};
  }
  const out = {};
  for (const r of res.rows) {
    out[r.tool_name] = r.mappings || {};
  }
  return out;
}

export async function setMitmAliasAll(toolName, mappings) {
  const p = await pool();
  await p.query(
    `INSERT INTO mitm_alias (tool_name, mappings) VALUES ($1, $2)
     ON CONFLICT (tool_name) DO UPDATE SET mappings = EXCLUDED.mappings`,
    [toolName, JSON.stringify(mappings || {})]
  );
}

// ---------- Combos ----------
export async function getCombos(userId = null) {
  const p = await pool();
  let q = "SELECT * FROM combos WHERE 1=1";
  const params = [];
  if (userId) {
    q += " AND user_id = $1";
    params.push(userId);
  }
  q += " ORDER BY created_at";
  const res = await p.query(q, params);
  return res.rows.map((r) => ({ ...rowToCamel(r), models: r.models || [] }));
}

export async function getComboById(id, userId = null) {
  const p = await pool();
  const res = await p.query("SELECT * FROM combos WHERE id = $1", [id]);
  const row = res.rows[0];
  if (!row) return null;
  const c = rowToCamel(row);
  if (userId && c.userId && c.userId !== userId) return null;
  return { ...c, models: row.models || [] };
}

export async function getComboByName(name, userId = null) {
  const p = await pool();
  let q = "SELECT * FROM combos WHERE name = $1";
  const params = [name];
  if (userId) {
    q += " AND user_id = $2";
    params.push(userId);
  }
  const res = await p.query(q, params);
  const row = res.rows[0];
  if (!row) return null;
  const c = rowToCamel(row);
  if (userId && c.userId && c.userId !== userId) return null;
  return { ...c, models: row.models || [] };
}

export async function createCombo(data, userId = null) {
  const p = await pool();
  const id = uuidv4();
  const now = new Date();
  await p.query(
    "INSERT INTO combos (id, user_id, name, models, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [id, userId, data.name, JSON.stringify(data.models || []), now, now]
  );
  return getComboById(id, userId);
}

export async function updateCombo(id, data, userId = null) {
  const existing = await getComboById(id, userId);
  if (!existing) return null;
  const p = await pool();
  const updates = [];
  const values = [];
  let i = 1;
  if (data.name !== undefined) {
    updates.push(`name = $${i++}`);
    values.push(data.name);
  }
  if (data.models !== undefined) {
    updates.push(`models = $${i++}`);
    values.push(JSON.stringify(data.models));
  }
  if (updates.length === 0) return existing;
  updates.push(`updated_at = $${i++}`);
  values.push(new Date());
  values.push(id);
  await p.query(`UPDATE combos SET ${updates.join(", ")} WHERE id = $${i}`, values);
  return getComboById(id, userId);
}

export async function deleteCombo(id, userId = null) {
  const existing = await getComboById(id, userId);
  if (!existing) return false;
  const p = await pool();
  await p.query("DELETE FROM combos WHERE id = $1", [id]);
  return true;
}

// ---------- API keys ----------
export async function getApiKeys(userId = null) {
  const p = await pool();
  let q = "SELECT * FROM api_keys WHERE 1=1";
  const params = [];
  if (userId) {
    q += " AND user_id = $1";
    params.push(userId);
  }
  q += " ORDER BY created_at";
  const res = await p.query(q, params);
  return res.rows.map(rowToCamel);
}

export async function getApiKeyById(id, userId = null) {
  const p = await pool();
  const res = await p.query("SELECT * FROM api_keys WHERE id = $1", [id]);
  const row = res.rows[0];
  if (!row) return null;
  const c = rowToCamel(row);
  if (userId && c.userId && c.userId !== userId) return null;
  return c;
}

export async function createApiKey(name, machineId, userId = null) {
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const p = await pool();
  const id = uuidv4();
  const now = new Date();
  await p.query(
    "INSERT INTO api_keys (id, user_id, name, key, machine_id, is_active, created_at) VALUES ($1, $2, $3, $4, $5, true, $6)",
    [id, userId, name, result.key, machineId, now]
  );
  return getApiKeyById(id, userId);
}

export async function updateApiKey(id, data, userId = null) {
  const existing = await getApiKeyById(id, userId);
  if (!existing) return null;
  const p = await pool();
  const updates = [];
  const values = [];
  let i = 1;
  if (data.name !== undefined) {
    updates.push(`name = $${i++}`);
    values.push(data.name);
  }
  if (data.isActive !== undefined) {
    updates.push(`is_active = $${i++}`);
    values.push(data.isActive);
  }
  if (updates.length === 0) return existing;
  values.push(id);
  await p.query(`UPDATE api_keys SET ${updates.join(", ")} WHERE id = $${i}`, values);
  return getApiKeyById(id, userId);
}

export async function deleteApiKey(id, userId = null) {
  const existing = await getApiKeyById(id, userId);
  if (!existing) return false;
  const p = await pool();
  await p.query("DELETE FROM api_keys WHERE id = $1", [id]);
  return true;
}

export async function validateApiKey(key) {
  const p = await pool();
  const res = await p.query(
    "SELECT * FROM api_keys WHERE key = $1 AND is_active = true",
    [key]
  );
  const row = res.rows[0];
  return row ? rowToCamel(row) : null;
}

// ---------- Cleanup ----------
export async function cleanupProviderConnections() {
  // PG: optional columns are already stored sparsely; no-op for consistency with local API.
  return 0;
}

// ---------- Users ----------
export async function getUsers() {
  const p = await pool();
  const res = await p.query("SELECT * FROM users ORDER BY created_at");
  return res.rows.map(rowToCamel);
}

export async function getUserById(id) {
  const p = await pool();
  const res = await p.query("SELECT * FROM users WHERE id = $1", [id]);
  return res.rows[0] ? rowToCamel(res.rows[0]) : null;
}

export async function getUserByOAuth(provider, oauthId) {
  const p = await pool();
  const res = await p.query(
    "SELECT * FROM users WHERE oauth_provider = $1 AND oauth_id = $2",
    [provider, oauthId]
  );
  return res.rows[0] ? rowToCamel(res.rows[0]) : null;
}

export async function getUserByEmail(email) {
  const p = await pool();
  const res = await p.query("SELECT * FROM users WHERE email = $1", [email]);
  return res.rows[0] ? rowToCamel(res.rows[0]) : null;
}

export async function getOrCreateUserByOAuth(provider, oauthId, profile = {}) {
  let user = await getUserByOAuth(provider, oauthId);
  if (user) {
    const p = await pool();
    await p.query("UPDATE users SET last_login_at = $1 WHERE id = $2", [
      new Date(),
      user.id,
    ]);
    return { ...user, lastLoginAt: new Date().toISOString() };
  }
  const p = await pool();
  const id = uuidv4();
  const now = new Date();
  const adminEmails = process.env.ADMIN_EMAILS
    ? process.env.ADMIN_EMAILS.split(",").map((e) => e.trim())
    : [];
  const isAdminEmail =
    adminEmails.length > 0 &&
    profile.email &&
    adminEmails.includes(profile.email);
  const countRes = await p.query("SELECT COUNT(*) AS c FROM users");
  const isFirst = Number(countRes.rows[0]?.c) === 0;
  const isAdmin = isAdminEmail || isFirst;
  await p.query(
    `INSERT INTO users (id, email, display_name, oauth_provider, oauth_id, tenant_id, is_admin, status, created_at, last_login_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9)`,
    [
      id,
      profile.email ?? null,
      profile.displayName ?? profile.name ?? null,
      provider,
      oauthId,
      profile.tenantId ?? null,
      isAdmin,
      now,
      now,
    ]
  );
  user = await getUserById(id);
  const settingsRes = await p.query("SELECT id FROM settings WHERE user_id = $1", [
    id,
  ]);
  if (settingsRes.rows.length === 0) {
    await p.query(
      `INSERT INTO settings (id, user_id, cloud_enabled, tunnel_enabled, tunnel_url, sticky_round_robin_limit, require_login, observability_enabled, observability_max_records, observability_batch_size, observability_flush_interval_ms, observability_max_json_size, outbound_proxy_enabled, outbound_proxy_url, outbound_no_proxy, fallback_strategy, created_at, updated_at)
       VALUES ($1, $2, false, false, '', 3, true, true, 1000, 20, 5000, 1024, false, '', '', 'fill-first', $3, $3)`,
      [uuidv4(), id, now]
    );
  }
  return user;
}

/**
 * Create a new user with email/password (registration). New user has status 'pending'.
 * Returns the created user or null if email already exists.
 */
export async function createUserWithPassword(email, passwordHash, displayName = null) {
  const existing = await getUserByEmail(email);
  if (existing) return null;
  const p = await pool();
  const id = uuidv4();
  const now = new Date();
  const adminEmails = process.env.ADMIN_EMAILS
    ? process.env.ADMIN_EMAILS.split(",").map((e) => e.trim())
    : [];
  const isAdminEmail =
    adminEmails.length > 0 && email && adminEmails.includes(email);
  const countRes = await p.query("SELECT COUNT(*) AS c FROM users");
  const isFirst = Number(countRes.rows[0]?.c) === 0;
  const isAdmin = isAdminEmail || isFirst;
  // First user can be active so admin can log in; otherwise pending
  const status = isFirst ? "active" : "pending";
  await p.query(
    `INSERT INTO users (id, email, display_name, oauth_provider, oauth_id, tenant_id, is_admin, status, password_hash, created_at, last_login_at)
     VALUES ($1, $2, $3, NULL, NULL, NULL, $4, $5, $6, $7, $8)`,
    [
      id,
      email,
      displayName || email.split("@")[0],
      isAdmin,
      status,
      passwordHash,
      now,
      now,
    ]
  );
  const user = await getUserById(id);
  const settingsRes = await p.query("SELECT id FROM settings WHERE user_id = $1", [
    id,
  ]);
  if (settingsRes.rows.length === 0) {
    await p.query(
      `INSERT INTO settings (id, user_id, cloud_enabled, tunnel_enabled, tunnel_url, sticky_round_robin_limit, require_login, observability_enabled, observability_max_records, observability_batch_size, observability_flush_interval_ms, observability_max_json_size, outbound_proxy_enabled, outbound_proxy_url, outbound_no_proxy, fallback_strategy, created_at, updated_at)
       VALUES ($1, $2, false, false, '', 3, true, true, 1000, 20, 5000, 1024, false, '', '', 'fill-first', $3, $3)`,
      [uuidv4(), id, now]
    );
  }
  return user;
}

export async function getOrCreateUserByEmail(email, displayName = null) {
  let user = await getUserByEmail(email);
  if (user) {
    const p = await pool();
    await p.query("UPDATE users SET last_login_at = $1 WHERE id = $2", [
      new Date(),
      user.id,
    ]);
    return { ...user, lastLoginAt: new Date().toISOString() };
  }
  const p = await pool();
  const id = uuidv4();
  const now = new Date();
  const adminEmails = process.env.ADMIN_EMAILS
    ? process.env.ADMIN_EMAILS.split(",").map((e) => e.trim())
    : [];
  const isAdminEmail =
    adminEmails.length > 0 && email && adminEmails.includes(email);
  const countRes = await p.query("SELECT COUNT(*) AS c FROM users");
  const isFirst = Number(countRes.rows[0]?.c) === 0;
  const isAdmin = isAdminEmail || isFirst;
  await p.query(
    `INSERT INTO users (id, email, display_name, oauth_provider, oauth_id, tenant_id, is_admin, status, created_at, last_login_at)
     VALUES ($1, $2, $3, NULL, NULL, NULL, $4, 'active', $5, $6)`,
    [
      id,
      email,
      displayName || email.split("@")[0],
      isAdmin,
      now,
      now,
    ]
  );
  user = await getUserById(id);
  const settingsRes = await p.query("SELECT id FROM settings WHERE user_id = $1", [
    id,
  ]);
  if (settingsRes.rows.length === 0) {
    await p.query(
      `INSERT INTO settings (id, user_id, cloud_enabled, tunnel_enabled, tunnel_url, sticky_round_robin_limit, require_login, observability_enabled, observability_max_records, observability_batch_size, observability_flush_interval_ms, observability_max_json_size, outbound_proxy_enabled, outbound_proxy_url, outbound_no_proxy, fallback_strategy, created_at, updated_at)
       VALUES ($1, $2, false, false, '', 3, true, true, 1000, 20, 5000, 1024, false, '', '', 'fill-first', $3, $3)`,
      [uuidv4(), id, now]
    );
  }
  return user;
}

export async function updateUser(id, data) {
  const p = await pool();
  const cols = [
    "email",
    "display_name",
    "oauth_provider",
    "oauth_id",
    "tenant_id",
    "is_admin",
    "status",
    "password_hash",
  ];
  const updates = [];
  const values = [];
  let i = 1;
  const map = {
    displayName: "display_name",
    oauthProvider: "oauth_provider",
    oauthId: "oauth_id",
    tenantId: "tenant_id",
    isAdmin: "is_admin",
    passwordHash: "password_hash",
  };
  for (const [k, v] of Object.entries(data)) {
    const col = map[k] || k;
    if (cols.includes(col)) {
      updates.push(`${col} = $${i++}`);
      values.push(v);
    }
  }
  if (updates.length === 0) return getUserById(id);
  updates.push(`last_login_at = $${i++}`);
  values.push(new Date());
  values.push(id);
  await p.query(`UPDATE users SET ${updates.join(", ")} WHERE id = $${i}`, values);
  return getUserById(id);
}

export async function deleteUser(id) {
  const p = await pool();
  const res = await p.query("DELETE FROM users WHERE id = $1 RETURNING id", [id]);
  return (res.rowCount || 0) > 0;
}

// ---------- Settings (first user or default) ----------
export async function getSettings() {
  const p = await pool();
  const res = await p.query(
    "SELECT * FROM settings ORDER BY user_id LIMIT 1"
  );
  const row = res.rows[0];
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    ...DEFAULT_SETTINGS,
    cloudEnabled: row.cloud_enabled,
    tunnelEnabled: row.tunnel_enabled,
    tunnelUrl: row.tunnel_url || "",
    stickyRoundRobinLimit: row.sticky_round_robin_limit ?? 3,
    requireLogin: row.require_login ?? true,
    observabilityEnabled: row.observability_enabled ?? true,
    observabilityMaxRecords: row.observability_max_records ?? 1000,
    observabilityBatchSize: row.observability_batch_size ?? 20,
    observabilityFlushIntervalMs: row.observability_flush_interval_ms ?? 5000,
    observabilityMaxJsonSize: row.observability_max_json_size ?? 1024,
    outboundProxyEnabled: row.outbound_proxy_enabled ?? false,
    outboundProxyUrl: row.outbound_proxy_url || "",
    outboundNoProxy: row.outbound_no_proxy || "",
    fallbackStrategy: row.fallback_strategy || "fill-first",
  };
}

export async function updateSettings(updates) {
  const p = await pool();
  const res = await p.query("SELECT id, user_id FROM settings ORDER BY user_id LIMIT 1");
  const row = res.rows[0];
  if (!row) {
    const userRes = await p.query("SELECT id FROM users ORDER BY created_at LIMIT 1");
    const uid = userRes.rows[0]?.id;
    if (!uid) return { ...DEFAULT_SETTINGS };
    const id = uuidv4();
    const now = new Date();
    const u = {
      cloudEnabled: updates.cloudEnabled ?? false,
      tunnelEnabled: updates.tunnelEnabled ?? false,
      tunnelUrl: updates.tunnelUrl ?? "",
      stickyRoundRobinLimit: updates.stickyRoundRobinLimit ?? 3,
      requireLogin: updates.requireLogin ?? true,
      observabilityEnabled: updates.observabilityEnabled ?? true,
      observabilityMaxRecords: updates.observabilityMaxRecords ?? 1000,
      observabilityBatchSize: updates.observabilityBatchSize ?? 20,
      observabilityFlushIntervalMs: updates.observabilityFlushIntervalMs ?? 5000,
      observabilityMaxJsonSize: updates.observabilityMaxJsonSize ?? 1024,
      outboundProxyEnabled: updates.outboundProxyEnabled ?? false,
      outboundProxyUrl: updates.outboundProxyUrl ?? "",
      outboundNoProxy: updates.outboundNoProxy ?? "",
      fallbackStrategy: updates.fallbackStrategy ?? "fill-first",
    };
    await p.query(
      `INSERT INTO settings (id, user_id, cloud_enabled, tunnel_enabled, tunnel_url, sticky_round_robin_limit, require_login, observability_enabled, observability_max_records, observability_batch_size, observability_flush_interval_ms, observability_max_json_size, outbound_proxy_enabled, outbound_proxy_url, outbound_no_proxy, fallback_strategy, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        id,
        uid,
        u.cloudEnabled,
        u.tunnelEnabled,
        u.tunnelUrl,
        u.stickyRoundRobinLimit,
        u.requireLogin,
        u.observabilityEnabled,
        u.observabilityMaxRecords,
        u.observabilityBatchSize,
        u.observabilityFlushIntervalMs,
        u.observabilityMaxJsonSize,
        u.outboundProxyEnabled,
        u.outboundProxyUrl,
        u.outboundNoProxy,
        u.fallbackStrategy,
        now,
        now,
      ]
    );
    return { ...DEFAULT_SETTINGS, ...u };
  }
  const set = [];
  const vals = [];
  let i = 1;
  const map = {
    cloudEnabled: "cloud_enabled",
    tunnelEnabled: "tunnel_enabled",
    tunnelUrl: "tunnel_url",
    stickyRoundRobinLimit: "sticky_round_robin_limit",
    requireLogin: "require_login",
    observabilityEnabled: "observability_enabled",
    observabilityMaxRecords: "observability_max_records",
    observabilityBatchSize: "observability_batch_size",
    observabilityFlushIntervalMs: "observability_flush_interval_ms",
    observabilityMaxJsonSize: "observability_max_json_size",
    outboundProxyEnabled: "outbound_proxy_enabled",
    outboundProxyUrl: "outbound_proxy_url",
    outboundNoProxy: "outbound_no_proxy",
    fallbackStrategy: "fallback_strategy",
  };
  for (const [k, v] of Object.entries(updates)) {
    const col = map[k];
    if (col) {
      set.push(`${col} = $${i++}`);
      vals.push(v);
    }
  }
  if (set.length === 0) return getSettings();
  vals.push(row.id);
  await p.query(`UPDATE settings SET ${set.join(", ")} WHERE id = $${i}`, vals);
  return getSettings();
}

// ---------- Export/Import (PG: export/import as JSON snapshot; import not full) ----------
export async function exportDb() {
  const p = await pool();
  const [users, providerConnections, providerNodes, modelAliases, combos, apiKeys, settings, pricing] =
    await Promise.all([
      p.query("SELECT * FROM users").then((r) => r.rows.map(rowToCamel)),
      p.query("SELECT * FROM provider_connections").then((r) => r.rows.map(rowToCamel)),
      p.query("SELECT * FROM provider_nodes").then((r) => r.rows.map(rowToCamel)),
      p.query("SELECT * FROM model_aliases").then((r) => r.rows.map(rowToCamel)),
      p.query("SELECT * FROM combos").then((r) => r.rows.map((row) => ({ ...rowToCamel(row), models: row.models || [] }))),
      p.query("SELECT * FROM api_keys").then((r) => r.rows.map(rowToCamel)),
      p.query("SELECT * FROM settings ORDER BY user_id LIMIT 1").then((r) => {
        const row = r.rows[0];
        if (!row) return DEFAULT_SETTINGS;
        return {
          cloudEnabled: row.cloud_enabled,
          tunnelEnabled: row.tunnel_enabled,
          tunnelUrl: row.tunnel_url || "",
          stickyRoundRobinLimit: row.sticky_round_robin_limit ?? 3,
          requireLogin: row.require_login ?? true,
          observabilityEnabled: row.observability_enabled ?? true,
          observabilityMaxRecords: row.observability_max_records ?? 1000,
          observabilityBatchSize: row.observability_batch_size ?? 20,
          observabilityFlushIntervalMs: row.observability_flush_interval_ms ?? 5000,
          observabilityMaxJsonSize: row.observability_max_json_size ?? 1024,
          outboundProxyEnabled: row.outbound_proxy_enabled ?? false,
          outboundProxyUrl: row.outbound_proxy_url || "",
          outboundNoProxy: row.outbound_no_proxy || "",
          fallbackStrategy: row.fallback_strategy || "fill-first",
        };
      }),
      p.query("SELECT * FROM pricing").then((r) => r.rows),
    ]);
  const pricingObj = {};
  for (const row of pricing) {
    if (!pricingObj[row.provider]) pricingObj[row.provider] = {};
    pricingObj[row.provider][row.model] = {
      inputCost: row.input_cost,
      outputCost: row.output_cost,
      currency: row.currency || "USD",
    };
  }
  return {
    users,
    providerConnections,
    providerNodes,
    modelAliases,
    mitmAlias: await getMitmAlias().then((m) => m),
    combos,
    apiKeys,
    settings: await getSettings(),
    pricing: pricingObj,
  };
}

export async function importDb(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid database payload");
  }
  const p = await pool();
  if (payload.users?.length) {
    for (const u of payload.users) {
      const existing = await getUserByEmail(u.email);
      if (!existing) {
        await p.query(
          `INSERT INTO users (id, email, display_name, oauth_provider, oauth_id, tenant_id, is_admin, status, password_hash, created_at, last_login_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (id) DO NOTHING`,
          [
            u.id,
            u.email,
            u.displayName ?? null,
            u.oauthProvider ?? null,
            u.oauthId ?? null,
            u.tenantId ?? null,
            u.isAdmin ?? false,
            u.status ?? "active",
            u.passwordHash ?? null,
            u.createdAt ?? new Date(),
            u.lastLoginAt ?? null,
          ]
        );
      }
    }
  }
  if (payload.settings && typeof payload.settings === "object") {
    await updateSettings(payload.settings);
  }
  return exportDb();
}

// ---------- Cloud ----------
export async function isCloudEnabled() {
  const s = await getSettings();
  return s.cloudEnabled === true;
}

export async function getCloudUrl() {
  const s = await getSettings();
  return s.cloudUrl || process.env.CLOUD_URL || process.env.NEXT_PUBLIC_CLOUD_URL || "";
}

// ---------- Pricing ----------
export async function getPricing() {
  const { getDefaultPricing } = await import("@/shared/constants/pricing.js");
  const defaultPricing = getDefaultPricing();
  const p = await pool();
  const res = await p.query("SELECT * FROM pricing");
  const userPricing = {};
  for (const row of res.rows) {
    if (!userPricing[row.provider]) userPricing[row.provider] = {};
    userPricing[row.provider][row.model] = {
      inputCost: row.input_cost,
      outputCost: row.output_cost,
      currency: row.currency || "USD",
    };
  }
  const merged = {};
  for (const [provider, models] of Object.entries(defaultPricing)) {
    merged[provider] = { ...models };
    if (userPricing[provider]) {
      for (const [model, pricing] of Object.entries(userPricing[provider])) {
        if (merged[provider][model]) {
          merged[provider][model] = { ...merged[provider][model], ...pricing };
        } else {
          merged[provider][model] = pricing;
        }
      }
    }
  }
  for (const [provider, models] of Object.entries(userPricing)) {
    if (!merged[provider]) merged[provider] = { ...models };
    else {
      for (const [model, pricing] of Object.entries(models)) {
        if (!merged[provider][model]) merged[provider][model] = pricing;
      }
    }
  }
  return merged;
}

/** Get first available pricing object for a provider (for fallback when model not found). */
function getProviderFallbackPricing(providerPricing) {
  if (!providerPricing || typeof providerPricing !== "object") return null;
  // Prefer "auto" for OpenRouter-style providers
  if (providerPricing.auto) return providerPricing.auto;
  const first = Object.values(providerPricing)[0];
  return first && typeof first === "object" ? first : null;
}

export async function getPricingForModel(provider, model) {
  const pricing = await getPricing();
  if (pricing[provider]?.[model]) return pricing[provider][model];

  const PROVIDER_ID_TO_ALIAS = {
    claude: "cc",
    codex: "cx",
    cursor: "anthropic", // Cursor IDE uses Claude/Anthropic models
    "gemini-cli": "gc",
    qwen: "qw",
    iflow: "if",
    antigravity: "ag",
    github: "gh",
    kiro: "kr",
    openai: "openai",
    anthropic: "anthropic",
    gemini: "gemini",
    openrouter: "openrouter",
    glm: "glm",
    kimi: "kimi",
    minimax: "minimax",
    deepseek: "deepseek",
    groq: "groq",
    xai: "xai",
    mistral: "mistral",
  };

  const alias = PROVIDER_ID_TO_ALIAS[provider];
  const providerKey = alias && pricing[alias] ? alias : provider;
  const providerPricing = pricing[providerKey];
  if (providerPricing?.[model]) return providerPricing[model];
  // Cursor/Claude style model names (e.g. claude-4.5-sonnet) -> Anthropic keys (claude-sonnet-4.5)
  const MODEL_ID_ALIAS = {
    "claude-4.5-sonnet": "claude-sonnet-4.5",
    "claude-4.5-haiku": "claude-haiku-4.5",
  };
  const modelAlias = MODEL_ID_ALIAS[model];
  if (modelAlias && providerPricing?.[modelAlias]) return providerPricing[modelAlias];
  // Fallback: use "auto" or first model for this provider so cost is never 0 when we have tokens
  return getProviderFallbackPricing(providerPricing) ?? (alias && pricing[alias] ? getProviderFallbackPricing(pricing[alias]) : null);
}

export async function updatePricing(pricingData) {
  const p = await pool();
  for (const [provider, models] of Object.entries(pricingData)) {
    for (const [model, pricing] of Object.entries(models)) {
      await p.query(
        `INSERT INTO pricing (id, provider, model, input_cost, output_cost, currency, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (provider, model) DO UPDATE SET input_cost = EXCLUDED.input_cost, output_cost = EXCLUDED.output_cost, updated_at = EXCLUDED.updated_at`,
        [
          uuidv4(),
          provider,
          model,
          pricing?.inputCost ?? null,
          pricing?.outputCost ?? null,
          pricing?.currency ?? "USD",
          new Date(),
          new Date(),
        ]
      );
    }
  }
  return getPricing();
}

export async function resetPricing(provider, model) {
  const p = await pool();
  if (model) {
    await p.query("DELETE FROM pricing WHERE provider = $1 AND model = $2", [
      provider,
      model,
    ]);
  } else {
    await p.query("DELETE FROM pricing WHERE provider = $1", [provider]);
  }
  return getPricing();
}

export async function resetAllPricing() {
  const p = await pool();
  await p.query("DELETE FROM pricing");
  return getPricing();
}
