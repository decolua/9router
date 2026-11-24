"use client";

import { useEffect, useState } from "react";
import { translate } from "@/i18n/runtime";

import Badge from "./Badge";
import Button from "./Button";
import { eventLabels } from "@/shared/constants/notificationTypes";

const url = "/api/notifications";
export default function NotificationBell({ admin }) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [page, setPage] = useState({ notifications: [], unread: 0 });
  const [error, setError] = useState(false);
  const [version, refresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const res = await fetch(url + (cursor ? "?before=" + cursor : ""), {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok) throw Error();
        const data = await res.json();
        if (!controller.signal.aborted) {
          setPage(data);
          setError(false);
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    };
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [cursor, version, open]);
  async function mark(id) {
    if (!admin) return;
    try {
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw Error();
      refresh((v) => v + 1);
    } catch {
      setError(true);
    }
  }
  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-label={translate("Notifications") + " (" + page.unread + ")"}
        className="relative flex items-center justify-center rounded-lg p-2 text-text-muted transition-all hover:bg-black/5 hover:text-text-main dark:hover:bg-white/5"
        onClick={() => {
          setCursor(null);
          setOpen(!open);
        }}
      >
        <span aria-hidden="true" className="material-symbols-outlined">
          notifications
        </span>
        {page.unread > 0 && (
          <Badge
            size="sm"
            variant="primary"
            className="absolute -right-1 -top-1 bg-surface px-1 ring-1 ring-border"
          >
            {page.unread}
          </Badge>
        )}
      </button>
      {open && (
        <section
          aria-label={translate("Notifications")}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.currentTarget.previousElementSibling?.focus();
              setOpen(false);
            }
          }}
          className="fixed right-2 sm:absolute sm:right-0 sm:top-full mt-2 w-96 max-w-[95vw] max-h-[70vh] overflow-y-auto z-50 rounded-xl border border-black/10 bg-surface py-1 shadow-2xl animate-in fade-in zoom-in-95 duration-150 dark:border-white/10"
        >
          <h2 className="border-b border-border-subtle px-4 py-2 text-sm font-semibold">
            Notifications
          </h2>
          {error && (
            <p role="alert" className="px-4 py-2 text-sm">
              Could not load notifications
            </p>
          )}
          {!error && !page.notifications.length && (
            <p className="px-4 py-2 text-sm text-text-muted">No notifications</p>
          )}
          <ul className="divide-y divide-border-subtle">
            {page.notifications.map((n) => (
              <li key={n.id} className="px-4 py-2.5 text-sm">
                <strong>{translate(eventLabels[n.type])}</strong> ·{" "}
                <span>{translate(n.state === "open" ? "Open incident" : "Resolved")}</span>
                <div className="break-words text-text-muted">
                  {n.label} {n.target}
                </div>
                <time dateTime={new Date(n.lastAt).toISOString()}>
                  {new Date(n.lastAt).toLocaleString()}
                </time>
                {admin && !n.readAt && (
                  <Button size="sm" variant="ghost" className="ml-2" onClick={() => mark(n.id)}>
                    Mark as read
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {cursor && (
            <Button size="sm" variant="ghost" className="ml-2" onClick={() => setCursor(null)}>
              Latest
            </Button>
          )}
          {page.notifications.length === 100 && (
            <Button size="sm" variant="ghost" onClick={() => setCursor(page.notifications.at(-1).id)}>
              Older notifications
            </Button>
          )}
        </section>
      )}
    </div>
  );
}
