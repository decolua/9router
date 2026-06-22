"use client";

import QRCode from "react-qr-code";

/** QR code for otpauth:// TOTP URIs (white quiet zone for reliable scanning). */
export function MfaQrCode({ uri, size = 192 }) {
  if (!uri) return null;
  return (
    <div
      className="inline-flex rounded-lg border border-border bg-white p-3"
      aria-label="Scan with your authenticator app"
    >
      <QRCode value={uri} size={size} level="M" />
    </div>
  );
}
