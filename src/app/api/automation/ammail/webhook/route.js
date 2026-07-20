import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb.js";
import { getAmmailClientFromSettings, extractOtp } from "@/lib/automation/ammailClient.js";
import { insertAmmailOtp } from "@/lib/db/index.js";
import crypto from "crypto";

export const dynamic = "force-dynamic";

function verifyAmmailSignature(secret, bodyText, signatureHeader) {
  if (!secret) return true;
  if (!signatureHeader) return false;

  let sig = signatureHeader.trim();
  if (sig.toLowerCase().startsWith("sha256=")) {
    sig = sig.substring(7);
  }

  const expected = crypto.createHmac("sha256", secret).update(bodyText).digest("hex");

  try {
    const expectedBuf = Buffer.from(expected);
    const sigBuf = Buffer.from(sig);
    if (expectedBuf.length !== sigBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, sigBuf);
  } catch (e) {
    return false;
  }
}

export async function POST(request) {
  try {
    const rawBody = await request.text();
    const settings = await getSettings();
    const secret = (settings.ammail_webhook_secret || "").trim();
    const sig = request.headers.get("x-tempmail-signature") || "";

    if (!verifyAmmailSignature(secret, rawBody, sig)) {
      return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401 });
    }

    let payload = {};
    try {
      payload = JSON.parse(rawBody);
    } catch (e) {}

    const event = String(payload.event || "");
    const data = payload.data || {};
    const inbox = data.inbox || {};
    const rawMessage = data.message;
    const messageMeta = (rawMessage && typeof rawMessage === "object") ? rawMessage : {};

    let address = (inbox.address || messageMeta.delivered_to || messageMeta.to_address || "").trim().toLowerCase();
    const alias = (inbox.alias || "").trim().toLowerCase();
    const domain = address.includes("@") ? address.split("@")[1] : "";

    if (event === "webhook.test") {
      await insertAmmailOtp({
        address: address || "test@example.com",
        alias: alias || "test",
        domain,
        sender: "ammail-worker",
        subject: "Webhook test",
        otpCode: "000000",
        verifyUrl: "",
        bodyText: "Webhook test from ammail worker.",
        bodyHtml: "",
        messageShortId: "test",
        rawEventJson: JSON.stringify(payload).substring(0, 32000),
      });
      return NextResponse.json({ ok: true, stored: "test" });
    }

    if (event !== "email.received") {
      return NextResponse.json({ ok: true, ignored: event || "unknown" });
    }

    const shortId = String(messageMeta.id || "");
    const sender = String(messageMeta.from_address || messageMeta.from_name || "");
    const subject = String(messageMeta.subject || "");
    const snippet = String(messageMeta.snippet || "");

    let textBody = snippet;
    let htmlBody = "";

    if (shortId) {
      const client = await getAmmailClientFromSettings();
      if (client.configured) {
        try {
          const full = await client.getMessage(shortId);
          textBody = String(full.text || textBody || "");
          htmlBody = String(full.html || "");
        } catch (e) {
          console.warn(`Failed to pull full Ammail message ${shortId}:`, e);
        }
      }
    }

    const { code, verifyUrl } = extractOtp(textBody, htmlBody, subject);

    await insertAmmailOtp({
      address,
      alias,
      domain,
      sender,
      subject,
      otpCode: code,
      verifyUrl,
      bodyText: textBody,
      bodyHtml: htmlBody,
      messageShortId: shortId,
      rawEventJson: JSON.stringify(payload).substring(0, 32000),
    });

    console.log(`Ammail OTP stored for ${address} code=${code || "-"} url=${verifyUrl ? "yes" : "-"}`);
    return NextResponse.json({ ok: true, otp: !!code, verify_url: !!verifyUrl });

  } catch (error) {
    console.error("Error in POST /api/automation/ammail/webhook:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
