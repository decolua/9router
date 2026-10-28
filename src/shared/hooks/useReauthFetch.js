"use client";

import { useCallback, useRef, useState } from "react";
import { Button, Input } from "@/shared/components";
import Modal from "@/shared/components/Modal";
import { fetchWithReauth } from "@/shared/utils/reauthFetch";

// Security-downgrade settings (requireLogin off, tunnel dashboard access on, SSO changes, …)
// make PATCH /api/settings answer 401 { code: "REAUTH_REQUIRED" } until the current
// password is supplied. reauthFetch is a drop-in for fetch: on that answer it asks for
// the password, retries once with `currentPassword` in the JSON body, and otherwise
// returns the response unchanged. Render `reauthModal` once in the page.
export function useReauthFetch() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const resolver = useRef(null);

  const finish = useCallback((value) => {
    setOpen(false);
    setPassword("");
    resolver.current?.(value);
    resolver.current = null;
  }, []);

  const askPassword = useCallback(() => new Promise((resolve) => {
    resolver.current = resolve;
    setPassword("");
    setOpen(true);
  }), []);

  const reauthFetch = useCallback(
    (url, init = {}) => fetchWithReauth(url, init, askPassword),
    [askPassword]
  );

  const reauthModal = (
    <Modal
      isOpen={open}
      onClose={() => finish(null)}
      title="Confirm Password"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => finish(null)}>Cancel</Button>
          <Button variant="primary" onClick={() => finish(password)} disabled={!password}>Confirm</Button>
        </>
      }
    >
      <p className="text-text-muted mb-3 text-sm">
        This change lowers your instance&apos;s protection or changes how users sign in. Enter your current dashboard password to continue.
      </p>
      <Input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && password) finish(password); }}
        placeholder="Current password"
        autoFocus
      />
    </Modal>
  );

  return { reauthFetch, reauthModal };
}
