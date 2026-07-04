import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import { qAll, qGet, qRun } from "../query.js";
import { getAdapter } from "../driver.js";
import { getDefaultOrgId } from "./organizationsRepo.js";
import { getRuntimeOrgId } from "../../auth/runtimeUserContext.js";

const INVITE_TOKEN_DOMAIN = "ebrouter-invite:";

function hashInviteToken(token) {
  const h = crypto.createHash("sha256");
  h.update(INVITE_TOKEN_DOMAIN);
  h.update(String(token));
  return h.digest("hex");
}

function pickRowField(row, camel) {
  if (!row) return undefined;
  if (row[camel] !== undefined && row[camel] !== null) return row[camel];
  const lower = camel.charAt(0).toLowerCase() + camel.slice(1);
  return row[lower];
}

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    orgId: pickRowField(row, "orgId") || null,
    email: row.email,
    name: row.name,
    role: row.role || "member",
    oidcSub: pickRowField(row, "oidcSub") || null,
    status: row.status || "active",
    mfaEnabled: !!(pickRowField(row, "mfaEnabled") === 1 || pickRowField(row, "mfaEnabled") === true),
    createdAt: pickRowField(row, "createdAt"),
    updatedAt: pickRowField(row, "updatedAt"),
  };
}

function withPasswordHash(row) {
  return row ? { ...rowToUser(row), passwordHash: pickRowField(row, "passwordHash") } : null;
}

async function resolveOrgId(orgId) {
  if (orgId != null && String(orgId).trim() !== "") return String(orgId).trim();
  const runtime = getRuntimeOrgId();
  if (runtime) return runtime;
  return getDefaultOrgId();
}

export async function getUsers(orgId) {
  const resolved = await resolveOrgId(orgId);
  const db = await getAdapter();
  try {
    const rows = await qAll(
      db,
      `SELECT id, orgId, email, name, role, oidcSub, status, mfaEnabled, createdAt, updatedAt FROM users WHERE orgId = ? ORDER BY createdAt ASC`,
      [resolved],
    );
    return rows.map(rowToUser);
  } catch (err) {
    const msg = String(err?.message || err);
    if (/mfaEnabled/i.test(msg) && /does not exist|no such column/i.test(msg)) {
      const rows = await qAll(
        db,
        `SELECT id, orgId, email, name, role, oidcSub, status, createdAt, updatedAt FROM users WHERE orgId = ? ORDER BY createdAt ASC`,
        [resolved],
      );
      return rows.map(rowToUser);
    }
    throw err;
  }
}

export async function getUserById(id) {
  const db = await getAdapter();
  const row = await qGet(db, `SELECT * FROM users WHERE id = ?`, [id]);
  return rowToUser(row);
}

export async function getUserByEmail(email, orgId) {
  const resolved = await resolveOrgId(orgId);
  const db = await getAdapter();
  const row = await qGet(
    db,
    `SELECT * FROM users WHERE orgId = ? AND LOWER(email) = LOWER(?)`,
    [resolved, String(email || "").trim()],
  );
  return withPasswordHash(row);
}

export async function getUserByOidcSub(oidcSub, orgId) {
  if (!oidcSub) return null;
  const resolved = await resolveOrgId(orgId);
  const db = await getAdapter();
  const row = await qGet(db, `SELECT * FROM users WHERE orgId = ? AND oidcSub = ?`, [resolved, oidcSub]);
  return withPasswordHash(row);
}

export async function getAdminUser(orgId) {
  const resolved = await resolveOrgId(orgId);
  const db = await getAdapter();
  const row = await qGet(
    db,
    `SELECT * FROM users WHERE orgId = ? AND role = 'admin' AND status = 'active' ORDER BY createdAt ASC LIMIT 1`,
    [resolved],
  );
  return withPasswordHash(row);
}

export async function countUsers(orgId) {
  const resolved = await resolveOrgId(orgId);
  const db = await getAdapter();
  const row = await qGet(db, `SELECT COUNT(*) AS n FROM users WHERE orgId = ?`, [resolved]);
  return row?.n ?? 0;
}

export async function createUser({ orgId, email, name, password, role = "member", oidcSub = null }) {
  const resolvedOrgId = await resolveOrgId(orgId);
  if (!resolvedOrgId) throw new Error("Organization not configured");

  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) throw new Error("Email is required");

  const existing = await getUserByEmail(normalizedEmail, resolvedOrgId);
  if (existing) throw new Error("Email already registered");

  const db = await getAdapter();
  const now = new Date().toISOString();
  const user = {
    id: uuidv4(),
    orgId: resolvedOrgId,
    email: normalizedEmail,
    name: (name || normalizedEmail.split("@")[0]).trim(),
    passwordHash: password ? await bcrypt.hash(password, 10) : null,
    role: role === "admin" ? "admin" : "member",
    oidcSub: oidcSub || null,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };

  await qRun(
    db,
    `INSERT INTO users(id, "orgId", email, name, "passwordHash", role, "oidcSub", status, "createdAt", "updatedAt") VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [user.id, user.orgId, user.email, user.name, user.passwordHash, user.role, user.oidcSub, user.status, user.createdAt, user.updatedAt],
  );

  await qRun(db, `INSERT INTO userSettings(userId, data) VALUES(?, ?)`, [user.id, "{}"]);
  return rowToUser(user);
}

export async function verifyUserPassword(email, password, orgId) {
  const user = await getUserByEmail(email, orgId);
  if (!user || user.status !== "active") return null;
  if (!user.passwordHash) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  return ok ? rowToUser(user) : null;
}

export async function updateUser(id, updates) {
  const db = await getAdapter();
  const row = await qGet(db, `SELECT * FROM users WHERE id = ?`, [id]);
  if (!row) return null;

  const next = {
    name: updates.name !== undefined ? updates.name : row.name,
    role: updates.role !== undefined ? updates.role : row.role,
    status: updates.status !== undefined ? updates.status : row.status,
    oidcSub: updates.oidcSub !== undefined ? updates.oidcSub : row.oidcSub,
    updatedAt: new Date().toISOString(),
  };

  if (updates.password) {
    next.passwordHash = await bcrypt.hash(updates.password, 10);
  } else {
    next.passwordHash = pickRowField(row, "passwordHash");
  }

  await qRun(
    db,
    `UPDATE users SET name = ?, passwordHash = ?, role = ?, status = ?, oidcSub = ?, updatedAt = ? WHERE id = ?`,
    [next.name, next.passwordHash, next.role, next.status, next.oidcSub, next.updatedAt, id],
  );

  return await getUserById(id);
}

export async function createInvite({ orgId, email = null, role = "member", createdBy, expiresInHours = 168 }) {
  const resolvedOrgId = await resolveOrgId(orgId);
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashInviteToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresInHours * 3600000).toISOString();
  const invite = {
    id: uuidv4(),
    orgId: resolvedOrgId,
    email: email ? String(email).trim().toLowerCase() : null,
    tokenHash,
    role: role === "admin" ? "admin" : "member",
    createdBy,
    expiresAt,
    usedAt: null,
    createdAt: now.toISOString(),
  };

  const db = await getAdapter();
  await qRun(
    db,
    `INSERT INTO userInvites(id, orgId, email, tokenHash, role, createdBy, expiresAt, usedAt, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [invite.id, invite.orgId, invite.email, invite.tokenHash, invite.role, invite.createdBy, invite.expiresAt, invite.usedAt, invite.createdAt],
  );

  return { ...invite, token };
}

export async function consumeInvite(token, { email, name, password, orgId }) {
  const resolvedOrgId = await resolveOrgId(orgId);
  const tokenHash = hashInviteToken(token);
  const db = await getAdapter();
  const row = await qGet(
    db,
    `SELECT * FROM userInvites WHERE tokenHash = ? AND (orgId IS NULL OR orgId = ? OR orgId = '')`,
    [tokenHash, resolvedOrgId],
  );
  if (!row) throw new Error("Invalid invite token");
  if (row.usedAt) throw new Error("Invite already used");
  if (row.expiresAt && new Date(row.expiresAt) < new Date()) throw new Error("Invite expired");

  const normalizedEmail = String(email || row.email || "").trim().toLowerCase();
  if (!normalizedEmail) throw new Error("Email is required");
  if (row.email && row.email.toLowerCase() !== normalizedEmail) {
    throw new Error("This invite is for a different email address");
  }

  const user = await createUser({
    orgId: row.orgId || resolvedOrgId,
    email: normalizedEmail,
    name,
    password,
    role: row.role,
  });

  await qRun(db, `UPDATE userInvites SET usedAt = ? WHERE id = ?`, [new Date().toISOString(), row.id]);
  return user;
}

export async function setUserStatus(id, status) {
  if (!["active", "disabled"].includes(status)) {
    throw new Error("Status must be active or disabled");
  }
  const db = await getAdapter();
  const target = await getUserById(id);
  if (!target) throw new Error("User not found");

  if (status === "disabled") {
    const admins = await qGet(
      db,
      `SELECT COUNT(*) AS n FROM users WHERE orgId = ? AND role = 'admin' AND status = 'active'`,
      [target.orgId],
    );
    if (target.role === "admin" && (admins?.n ?? 0) <= 1) {
      throw new Error("Cannot disable the last admin user");
    }
  }

  await qRun(
    db,
    `UPDATE users SET status = ?, updatedAt = ? WHERE id = ?`,
    [status, new Date().toISOString(), id],
  );
  return await getUserById(id);
}

function userKvScope(scope, userId) {
  return `${scope}:user:${userId}`;
}

async function purgeUserData(db, userId) {
  for (const table of ["providerConnections", "apiKeys", "combos", "usageHistory", "requestDetails"]) {
    await qRun(db, `DELETE FROM ${table} WHERE userId = ?`, [userId]);
  }
  for (const scope of ["modelAliases", "customModels", "mitmAlias"]) {
    await qRun(db, `DELETE FROM kv WHERE scope = ?`, [userKvScope(scope, userId)]);
  }
  await qRun(db, `DELETE FROM userSettings WHERE userId = ?`, [userId]);
}

export async function deleteUser(id) {
  const db = await getAdapter();
  const target = await getUserById(id);
  if (!target) throw new Error("User not found");

  const activeAdmins = await qGet(
    db,
    `SELECT COUNT(*) AS n FROM users WHERE orgId = ? AND role = 'admin' AND status = 'active'`,
    [target.orgId],
  );
  if (target.role === "admin" && (activeAdmins?.n ?? 0) <= 1) {
    throw new Error("Cannot delete the last admin user");
  }

  if (db.dialect === "postgres") {
    await db.transaction(async (tx) => {
      await purgeUserData(tx, id);
      await qRun(tx, `DELETE FROM users WHERE id = ?`, [id]);
    });
  } else {
    db.transaction(() => {
      purgeUserDataSync(db, id);
      db.run(`DELETE FROM users WHERE id = ?`, [id]);
    });
  }
  return true;
}

export async function getUserMfaState(userId) {
  try {
    const db = await getAdapter();
    const row = await qGet(db, `SELECT mfaEnabled, mfaSecret FROM users WHERE id = ?`, [userId]);
    if (!row) return null;
    return {
      mfaEnabled: !!(pickRowField(row, "mfaEnabled") === 1 || pickRowField(row, "mfaEnabled") === true),
      mfaSecret: pickRowField(row, "mfaSecret") || null,
    };
  } catch (err) {
    const msg = String(err?.message || err);
    if (/mfaEnabled|mfaSecret/i.test(msg) && /does not exist|no such column/i.test(msg)) {
      return { mfaEnabled: false, mfaSecret: null };
    }
    throw err;
  }
}

export async function setUserMfaSecret(userId, secret) {
  const db = await getAdapter();
  await qRun(db, `UPDATE users SET mfaSecret = ?, updatedAt = ? WHERE id = ?`, [secret, new Date().toISOString(), userId]);
}

export async function setUserMfaEnabled(userId, enabled) {
  const db = await getAdapter();
  await qRun(db, `UPDATE users SET mfaEnabled = ?, updatedAt = ? WHERE id = ?`, [enabled ? 1 : 0, new Date().toISOString(), userId]);
}

export async function setUserRole(id, role) {
  if (!["admin", "member"].includes(role)) throw new Error("Role must be admin or member");
  const db = await getAdapter();
  const target = await getUserById(id);
  if (!target) throw new Error("User not found");

  if (target.role === "admin" && role !== "admin") {
    const admins = await qGet(
      db,
      `SELECT COUNT(*) AS n FROM users WHERE orgId = ? AND role = 'admin' AND status = 'active'`,
      [target.orgId],
    );
    if ((admins?.n ?? 0) <= 1) throw new Error("Cannot demote the last admin user");
  }

  await qRun(db, `UPDATE users SET role = ?, updatedAt = ? WHERE id = ?`, [role, new Date().toISOString(), id]);
  return await getUserById(id);
}

function purgeUserDataSync(db, userId) {
  for (const table of ["providerConnections", "apiKeys", "combos", "usageHistory", "requestDetails"]) {
    db.run(`DELETE FROM ${table} WHERE userId = ?`, [userId]);
  }
  for (const scope of ["modelAliases", "customModels", "mitmAlias"]) {
    db.run(`DELETE FROM kv WHERE scope = ?`, [userKvScope(scope, userId)]);
  }
  db.run(`DELETE FROM userSettings WHERE userId = ?`, [userId]);
}
