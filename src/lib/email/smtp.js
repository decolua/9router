// Optional SMTP delivery for password-reset emails.
// When SMTP is not configured, reset URLs are returned to admins via the API instead.

function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

export function isSmtpConfigured() {
  return smtpConfigured();
}

export async function sendPasswordResetEmail({ to, resetUrl }) {
  if (!smtpConfigured()) {
    console.info(`[email] SMTP not configured — password reset URL not emailed to ${to}`);
    console.info(`[email] Reset URL: ${resetUrl}`);
    return { sent: false, reason: "smtp_not_configured" };
  }

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";
  const from = process.env.SMTP_FROM;
  const secure = process.env.SMTP_SECURE === "true" || port === 465;

  const subject = "ebRouter password reset";
  const text = [
    "A password reset was requested for your ebRouter account.",
    "",
    `Reset your password: ${resetUrl}`,
    "",
    "This link expires in 1 hour. If you did not request this, ignore this email.",
  ].join("\n");

  const { connect } = await import("node:net");
  const { connect: tlsConnect } = await import("node:tls");

  return new Promise((resolve, reject) => {
    let stage = "greet";
    let buffer = "";
    const socket = secure
      ? tlsConnect({ host, port, rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== "false" })
      : connect({ host, port });

    const send = (line) => socket.write(`${line}\r\n`);

    const fail = (err) => {
      socket.destroy();
      reject(err);
    };

    socket.on("error", fail);
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      while (buffer.includes("\r\n")) {
        const idx = buffer.indexOf("\r\n");
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const code = Number(line.slice(0, 3));
        if (Number.isNaN(code)) continue;

        if (stage === "greet" && code === 220) {
          send(`EHLO ${host}`);
          stage = "ehlo";
        } else if (stage === "ehlo" && code === 250 && !line.startsWith("250-")) {
          if (user && pass) {
            send("AUTH LOGIN");
            stage = "auth-user";
          } else {
            send(`MAIL FROM:<${from}>`);
            stage = "mail-from";
          }
        } else if (stage === "auth-user" && code === 334) {
          send(Buffer.from(user).toString("base64"));
          stage = "auth-pass";
        } else if (stage === "auth-pass" && code === 334) {
          send(Buffer.from(pass).toString("base64"));
          stage = "auth-wait";
        } else if (stage === "auth-wait" && code === 235) {
          send(`MAIL FROM:<${from}>`);
          stage = "mail-from";
        } else if (stage === "mail-from" && code === 250) {
          send(`RCPT TO:<${to}>`);
          stage = "rcpt";
        } else if (stage === "rcpt" && code === 250) {
          send("DATA");
          stage = "data";
        } else if (stage === "data" && code === 354) {
          send(`From: ${from}`);
          send(`To: ${to}`);
          send(`Subject: ${subject}`);
          send("MIME-Version: 1.0");
          send("Content-Type: text/plain; charset=utf-8");
          send("");
          send(text);
          send(".");
          stage = "done";
        } else if (stage === "done" && code === 250) {
          send("QUIT");
          socket.end();
          resolve({ sent: true });
        } else if (code >= 400) {
          fail(new Error(`SMTP error: ${line}`));
        }
      }
    });
  });
}
