"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button } from "@/shared/components";
import { translate } from "@/i18n/runtime";

// "Use Desktop App" for MiniMax Code: creates a lease connection that borrows
// the signed-in MiniMax Code desktop app's credentials over its local
// named-pipe broker. No browser login, no stored refresh token — the desktop
// app keeps owning token refresh, so the official CLI and 9router can share
// the same subscription without their single-use refresh tokens fighting.
export default function MinimaxLeaseButton({ providerId, onConnected, size = "sm" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleConnect = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/oauth/${providerId}/lease-connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not reach the MiniMax Code desktop app");
        return;
      }
      if (typeof onConnected === "function") onConnected();
    } catch (err) {
      setError(err?.message || "Could not reach the MiniMax Code desktop app");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        size={size}
        icon="desktop_windows"
        variant="secondary"
        disabled={busy}
        onClick={handleConnect}
        title={translate("Borrow the signed-in MiniMax Code desktop app's login — no second sign-in, refresh stays with the desktop app")}
      >
        {busy ? translate("Connecting...") : translate("Use Desktop App")}
      </Button>
      {error && <p className="w-full text-xs text-red-500 break-words">{error}</p>}
    </>
  );
}

MinimaxLeaseButton.propTypes = {
  providerId: PropTypes.string.isRequired,
  onConnected: PropTypes.func,
  size: PropTypes.oneOf(["sm", "md", "lg"]),
};
