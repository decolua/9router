"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ChangelogModal from "./ChangelogModal";
import BellMenu from "./BellMenu";
import NotifToast, { mergeLiveTasks } from "./NotifToast";
import { useSessionStore } from "@/store/sessionStore";
import { useTaskStore } from "@/store/taskStore";

const POLL_MS = 60000;

const SEVERITY_STYLE = {
  error: { dot: "bg-red-500", text: "text-red-500", icon: "report" },
  warning: { dot: "bg-amber-500", text: "text-amber-500", icon: "warning_amber" },
  info: { dot: "bg-primary", text: "text-primary", icon: "announcement" },
};

/**
 * Notification bell: quota pressure, updates and anything the scan route
 * derives. A key-signed session gets nothing - these messages describe this
 * install, not the caller's own key.
 *
 * Live long tasks live here too, through NotifToast. The import progress the
 * operator used to read off a card floating over the table covered the very
 * page they were trying to work on, so that dock is gone: every long
 * operation reports into the task store and surfaces here. Progress is
 * visible while this menu is open, and the badge says the rest of the time.
 */
export default function NotificationBell() {
  const role = useSessionStore((state) => state.role);
  const isAdmin = role !== "apikey";
  const [open, setOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [jobs, setJobs] = useState([]);
  const ref = useRef(null);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setItems(Array.isArray(data.notifications) ? data.notifications : []);
      setUnread(Number(data.unread) || 0);
    } catch {
      // A failed poll must not disturb the header.
    }
  }, [isAdmin]);

  // Conditions are derived server-side (deduped); polling keeps the badge fresh
  // without a socket, and the scan is cheap because nothing new is written twice.
  useEffect(() => {
    if (!isAdmin) return undefined;
    load();
    fetch("/api/notifications/scan", { cache: "no-store" }).catch(() => {});
    const timer = setInterval(() => {
      load();
      fetch("/api/notifications/scan", { cache: "no-store" }).catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [isAdmin, load]);

  // Running server-side operations. Listed here so a job that outlived the page
  // that started it is still reachable: the banner sits collapsed in a corner
  // with nothing pointing at it, and "where did that import go" has no answer
  // without this list.
  const loadJobs = useCallback(async () => {
    if (!isAdmin) return;
    const live = [];
    try {
      // The proxy-import job predates the generic runner and keeps its own
      // store, so both lists are read and shown as one queue: to the operator
      // "an operation I started is still running" does not depend on which
      // subsystem happens to own it.
      const [imports, generic] = await Promise.all([
        fetch("/api/proxy-pools/import-jobs", { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : { jobs: [] }))
          .catch(() => ({ jobs: [] })),
        fetch("/api/dashboard-jobs", { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : { jobs: [] }))
          .catch(() => ({ jobs: [] })),
      ]);

      for (const job of Array.isArray(imports.jobs) ? imports.jobs : []) {
        if (job.status === "queued" || job.status === "running") {
          live.push({
            id: job.id,
            taskId: "proxy-pools-import",
            title: "Importing proxies",
            message: job.message || "",
            progress: Number(job.progress) || 0,
            status: job.status,
            href: "/dashboard/proxy-pools",
          });
        }
      }
      for (const job of Array.isArray(generic.jobs) ? generic.jobs : []) {
        if (job.status === "queued" || job.status === "running") {
          live.push({
            id: job.id,
            // The banner for this job is keyed the same way on the task store,
            // which is how the click below knows whether to reopen a banner it
            // is already rendering or to navigate to the page that owns it.
            taskId: `dashboard-job-${job.kind}`,
            title: job.title || job.kind,
            message: job.message || "",
            progress: Number(job.progress) || 0,
            status: job.status,
            href: "/dashboard/proxy-pools",
          });
        }
      }
      live.sort((a, b) => (a.id < b.id ? 1 : -1));
      setJobs(live);
    } catch {
      // A failed poll must not disturb the header.
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return undefined;
    loadJobs();
    const timer = setInterval(loadJobs, 4000);
    return () => clearInterval(timer);
  }, [isAdmin, loadJobs]);

  // The task store holds whatever banner is mounted; when a job is showing there
  // already the bell only mirrors its state, and clicking must not expand two
  // cards for one operation. (The selector returns the store array itself, not
  // a derived .map(): a derived array is a new reference every render, which
  // re-subscribes the component on every paint and loops the page to death.)
  const tasks = useTaskStore((state) => state.tasks);
  const live = useMemo(() => mergeLiveTasks(tasks, jobs), [tasks, jobs]);
  // A finished run is still listed for its grace window, but it is not work in
  // flight: the dot and the aria label say "running", so they count only these.
  const running = live.filter((t) => t.state !== "done").length;
  // Unread notices plus live tasks: an import still running keeps its badge
  // after the operator has read every notice, which is the case that made the
  // badge feel like it lied.
  const badge = unread + live.length;

  const markAllRead = async () => {
    setUnread(0);
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      const res = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "read", id: "all" }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Number.isFinite(data.unread)) setUnread(data.unread);
      }
    } catch {
      load();
    }
  };

  // Per-row controls. Both write through to the feed and then trust the
  // server's own recount, so a concurrent scan cannot leave the badge lying.
  const postRow = async (body, apply) => {
    apply();
    try {
      const res = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        if (Number.isFinite(data.unread)) setUnread(data.unread);
      } else {
        load();
      }
    } catch {
      load();
    }
  };

  const markReadOne = (n) =>
    postRow({ action: "read", id: n.id }, () => {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    });

  // Dismissing keeps the row's dedupeKey, so a condition that is still true is
  // announced again by the next scan instead of being suppressed for good.
  const dismissOne = (n) =>
    postRow({ action: "clear", id: n.id }, () => {
      setItems((prev) => prev.filter((x) => x.id !== n.id));
    });

  // A row is a status readout: with the floating dock gone there is nothing to
  // expand, so picking one only helps when it can take the operator to the
  // page that owns the run.
  const handlePick = (task) => {
    setOpen(false);
    if (task.href && typeof window !== "undefined") {
      window.location.assign(task.href);
    }
  };

  if (!isAdmin) return null;

  const visible = items.filter((n) => !n.cleared);

  return (
    <div ref={ref}>
      <button
        type="button"
        onClick={() =>
          setOpen((v) => {
            // Refresh on open: a poll interval is right for the badge, but a
            // user opening the panel is asking "what is running right now"
            // and must not wait out the remainder of a 4s tick.
            if (!v) loadJobs();
            return !v;
          })
        }
        className="relative flex size-10 shrink-0 items-center justify-center rounded-[10px] text-text-muted hover:text-text-main hover:bg-surface-2 transition-colors"
        title="Notifications"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}${
          running ? `, ${running} running` : ""
        }`}
        aria-expanded={open}
      >
        <span className="material-symbols-outlined text-[20px]">notifications_active</span>
        {running > 0 && (
          // Sits clear of the badge's circle (outside it by ~1.5px) rather than
          // under it, so the count is never half-covered.
          <span
            aria-hidden="true"
            className="absolute -top-1.5 -right-1.5 size-1.5 rounded-full bg-success"
          />
        )}
        {badge > 0 && (
          <span
            className={`absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full text-[10px] font-bold leading-[16px] text-white ${
              items.some((n) => !n.read && n.severity === "error") ? "bg-red-500" : "bg-primary"
            }`}
          >
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </button>

      <BellMenu
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={ref}
        label="Notifications"
        header={
          <div className="flex items-center justify-between border-b border-border-subtle px-3.5 py-2.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              Notifications
            </span>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-[11px] text-primary hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>
        }
      >
        <NotifToast jobs={jobs} onPick={handlePick} />
        {visible.length === 0 ? (
          // Only claim "nothing" when the panel really is empty: a running
          // task listed just above contradicts it.
          <p className="px-4 py-6 text-center text-xs text-text-muted">
            {live.length > 0 ? "No notifications." : "Nothing to report."}
          </p>
        ) : (
          visible.map((n) => {
            const style = SEVERITY_STYLE[n.severity] || SEVERITY_STYLE.info;
            // Every entry opens the changelog: the bell says something
            // changed, and the changelog says what.
            return (
              // Siblings, not a button in a button: the row stays clickable to
              // open the changelog, and the two controls keep their own hit area.
              <div
                key={n.id}
                className="flex items-start border-b border-border-subtle/60 last:border-0"
              >
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setChangelogOpen(true);
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <span
                    className={`flex items-start gap-2 px-3.5 py-2.5 transition-colors hover:bg-surface-2 ${
                      n.read ? "opacity-65" : ""
                    }`}
                  >
                    <span
                      className={`material-symbols-outlined text-[16px] mt-0.5 shrink-0 ${style.text}`}
                    >
                      {style.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium text-text-main">{n.title}</span>
                      {n.body && (
                        <span className="block text-[11px] text-text-muted mt-0.5 break-words">
                          {n.body}
                        </span>
                      )}
                      <span className="block text-[10px] text-text-muted/70 mt-1">
                        {new Date(n.at).toLocaleString()}
                      </span>
                    </span>
                    {!n.read && (
                      <span className={`size-1.5 rounded-full mt-1.5 shrink-0 ${style.dot}`} />
                    )}
                  </span>
                </button>
                <div className="flex shrink-0 items-center gap-0.5 pr-2.5 py-2.5">
                  {!n.read && (
                    <button
                      type="button"
                      onClick={() => markReadOne(n)}
                      title="Mark as read"
                      aria-label={`Mark ${n.title} as read`}
                      className="flex size-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-text-main"
                    >
                      <span className="material-symbols-outlined text-[15px]">done_all</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => dismissOne(n)}
                    title="Remove notification"
                    aria-label={`Remove ${n.title}`}
                    className="flex size-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-text-main"
                  >
                    <span className="material-symbols-outlined text-[15px]">delete_forever</span>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </BellMenu>

      <ChangelogModal isOpen={changelogOpen} onClose={() => setChangelogOpen(false)} />
    </div>
  );
}
