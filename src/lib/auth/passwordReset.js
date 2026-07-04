import crypto from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import { qGet, qRun } from "@/lib/db/query.js";
import { getAdapter } from "@/lib/db/driver.js";
import { getUserByEmail, updateUser } from "@/lib/db/repos/usersRepo.js";
import { validatePassword } from "./passwordPolicy.js";
import { sendPasswordResetEmail } from "@/lib/email/smtp.js";
import { getPublicOrigin } from "./oidc.js";

const RESET_TOKEN_DOMAIN = "ebrouter-password-reset:";
const DEFAULT_TTL_HOURS = Number(process.env.PASSWORD_RESET_TTL_HOURS || 1);

function hashToken(token) {
  const h = crypto.createHash("sha256");
  h.update(RESET_TOKEN_DOMAIN);
  h.update(String(token));
  return h.digest("hex");
}

function resolveResetBaseUrl(request) {
  if (request) return getPublicOrigin(request);
  return (process.env.BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
}

export async function createPasswordResetToken(email, { orgId, createdBy = null, request = null } = {}) {
  const user = await getUserByEmail(email, orgId);
  if (!user || user.status !== "active" || !user.passwordHash) {
    return { user: null, token: null, resetUrl: null };
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + DEFAULT_TTL_HOURS * 3600000).toISOString();
  const id = uuidv4();

  const db = await getAdapter();
  await qRun(db, `DELETE FROM passwordResetTokens WHERE userId = ? AND usedAt IS NULL`, [user.id]);
  await qRun(
    db,
    `INSERT INTO passwordResetTokens(id, userId, tokenHash, expiresAt, usedAt, createdBy, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
    [id, user.id, tokenHash, expiresAt, null, createdBy, now.toISOString()]
  );

  const base = resolveResetBaseUrl(request);
  const resetUrl = base ? `${base}/reset-password?token=${encodeURIComponent(token)}` : null;
  if (!resetUrl) {
    console.warn(
      "[password-reset] Could not determine public origin — reset link cannot be built. Set BASE_URL in .env (e.g. http://localhost:20128)."
    );
  }

  return { user, token, resetUrl };
}

export async function requestPasswordReset(email, { orgId, request = null } = {}) {
  const result = await createPasswordResetToken(email, { orgId, request });
  if (result.user && result.resetUrl) {
    await sendPasswordResetEmail({
      to: result.user.email,
      resetUrl: result.resetUrl,
    });
  }
  return { ok: true };
}

export async function consumePasswordResetToken(token, newPassword) {
  const check = validatePassword(newPassword);
  if (!check.ok) throw new Error(check.error);

  const tokenHash = hashToken(token);
  const db = await getAdapter();
  const row = await qGet(db, `SELECT * FROM passwordResetTokens WHERE tokenHash = ?`, [tokenHash]);
  if (!row) throw new Error("Invalid or expired reset link");
  if (row.usedAt) throw new Error("Reset link already used");
  if (row.expiresAt && new Date(row.expiresAt) < new Date()) throw new Error("Reset link expired");

  await updateUser(row.userId, { password: newPassword });
  await qRun(db, `UPDATE passwordResetTokens SET usedAt = ? WHERE id = ?`, [new Date().toISOString(), row.id]);
  return true;
}
