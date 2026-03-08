/**
 * Email notifications for approval flow.
 * Supports Resend (RESEND_API_KEY) or SMTP (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM).
 * If neither is configured, sends are no-op (logged in development).
 */

const RESEND_API = "https://api.resend.com/emails";

function isResendConfigured() {
  return typeof process !== "undefined" && process.env?.RESEND_API_KEY;
}

function isSmtpConfigured() {
  const env = typeof process !== "undefined" ? process.env : {};
  return !!(env.SMTP_HOST && env.SMTP_FROM);
}

/**
 * Get admin emails to notify (e.g. on new pending registration).
 * Uses NOTIFY_ADMIN_EMAILS or ADMIN_EMAILS (comma-separated), or falls back to empty.
 */
export function getAdminNotificationEmails() {
  const env = typeof process !== "undefined" ? process.env : {};
  const raw =
    env.NOTIFY_ADMIN_EMAILS || env.ADMIN_EMAILS || "";
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Send an email. No-op if no transport is configured.
 * @param {{ to: string | string[], subject: string, html: string, from?: string }} options
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function sendEmail({ to, subject, html, from }) {
  const recipients = Array.isArray(to) ? to : [to];
  const filtered = recipients.filter((e) => e && e.includes("@"));

  if (filtered.length === 0) {
    return { ok: false, error: "No valid recipients" };
  }

  if (isResendConfigured()) {
    return sendViaResend({ to: filtered, subject, html, from });
  }
  if (isSmtpConfigured()) {
    return sendViaSmtp({ to: filtered, subject, html, from });
  }

  if (process.env.NODE_ENV !== "production") {
    console.log("[email] No transport configured. Would send:", {
      to: filtered,
      subject,
    });
  }
  return { ok: true };
}

async function sendViaResend({ to, subject, html, from }) {
  const env = process.env;
  const fromAddress = from || env.RESEND_FROM || env.SMTP_FROM || "EGS Proxy AI <onboarding@resend.dev>";

  try {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: fromAddress,
        to: to.length === 1 ? to[0] : to,
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[email] Resend error:", res.status, err);
      return { ok: false, error: err };
    }
    return { ok: true };
  } catch (err) {
    console.error("[email] Resend send failed:", err);
    return { ok: false, error: err.message };
  }
}

async function sendViaSmtp({ to, subject, html, from }) {
  const env = process.env;
  const fromAddress = from || env.SMTP_FROM;

  try {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.default.createTransport({
      host: env.SMTP_HOST,
      port: parseInt(env.SMTP_PORT || "587", 10),
      secure: env.SMTP_SECURE === "true",
      auth:
        env.SMTP_USER && env.SMTP_PASS
          ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
          : undefined,
    });

    await transport.sendMail({
      from: fromAddress,
      to: to.join(", "),
      subject,
      html,
    });
    return { ok: true };
  } catch (err) {
    console.error("[email] SMTP send failed:", err);
    return { ok: false, error: err.message };
  }
}

/**
 * Send "new registration pending approval" to admins.
 */
export async function notifyAdminsNewPendingRegistration({ email, displayName }) {
  const adminEmails = getAdminNotificationEmails();
  if (adminEmails.length === 0) return { ok: true };

  const appName = "EGS Proxy AI";
  const subject = `[${appName}] New registration pending approval`;
  const html = `
    <p>A new user has registered and is pending approval.</p>
    <ul>
      <li><strong>Email:</strong> ${escapeHtml(email)}</li>
      <li><strong>Display name:</strong> ${escapeHtml(displayName || "—")}</li>
    </ul>
    <p>Go to the admin users page to approve or reject.</p>
  `;

  return sendEmail({ to: adminEmails, subject, html });
}

/**
 * Send "your account has been approved" to the user.
 */
export async function notifyUserApproved({ email, displayName }) {
  if (!email || !email.includes("@")) return { ok: true };

  const appName = "EGS Proxy AI";
  const subject = `[${appName}] Your account has been approved`;
  const name = displayName || email.split("@")[0];
  const html = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>Your ${appName} account has been approved. You can sign in now.</p>
    <p>If you have any questions, contact your administrator.</p>
  `;

  return sendEmail({ to: email, subject, html });
}

function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
