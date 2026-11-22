"use client";

import { useMemo, useState } from "react";
import PropTypes from "prop-types";
import { useTaskStore } from "@/store/taskStore";

/**
 * Merge the two live-task sources into one queue for the bell.
 *
 * The task store is the fresher copy: a polled server job whose task id is
 * already a task in the store is dropped, or one run would show twice - two
 * rows, two percents, two places to click. What is left from the poll is a
 * run whose owning page is closed and never adopted it into the store, which
 * is exactly the case the bell exists for: "where did that import go".
 */
export function mergeLiveTasks(tasks, jobs) {
  const seen = new Set(tasks.map((t) => t.id));
  const merged = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    message: t.message,
    progress: t.progress,
    // Store rows retire through the store itself; polled-only rows have no
    // store entry, so the X on those only hides them in this panel.
    source: "store",
    // A task stays in the store after it finishes so the bell can say so; the
    // store's own timer retires it, so state is carried, not assumed.
    state: t.state || "running",
    // Where this run is driven from, so a row can still take the operator back
    // to it once the page that started it is closed.
    href: t.href || null,
  }));
  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (!job || !job.taskId || seen.has(job.taskId)) continue;
    seen.add(job.taskId);
    merged.push({
      id: job.taskId,
      title: job.title,
      message: job.message,
      progress: job.progress,
      state: job.status === "queued" ? "queued" : "running",
      href: job.href || null,
      source: "job",
    });
  }
  return merged;
}

// The store carries whole percents and a
// caller handing in a fraction is read as one. Splitting the rule would let
// the bell and the floating card disagree about the same run.
function percentOf(progress) {
  if (typeof progress !== "number" || !Number.isFinite(progress)) return null;
  return Math.min(100, Math.max(0, Math.round(progress <= 1 ? progress * 100 : progress)));
}

/**
 * The bell's live-task surface: title, done/total, a percent bar and the task
 * state, read straight from the task store the operations report into.
 *
 * A direct subscription, not a prop: the point of this surface is that a task
 * started on any page appears in the bell at the same paint the banner gets
 * it, with no second poll to fall behind. The polled server-job list rides in
 * as a prop only to cover runs no page has adopted.
 */
export default function NotifToast({ jobs = [], onPick = null }) {
  const tasks = useTaskStore((state) => state.tasks);
  const dismiss = useTaskStore((state) => state.dismiss);
  // Polled-only rows belong to a run whose page is closed and never entered
  // the store, so there is nothing to retire server-side from here; the X only
  // hides them in this panel until the run itself ends and the poll drops it.
  const [hidden, setHidden] = useState(() => new Set());
  const live = useMemo(
    () =>
      // Finished rows sort last: what is still running is what the operator is
      // scanning for, and it should not sit under a retired run.
      [...mergeLiveTasks(tasks, jobs)]
        .sort((a, b) => Number(a.state === "done") - Number(b.state === "done"))
        .filter((t) => (t.source === "job" ? !hidden.has(t.id) : true)),
    [tasks, jobs, hidden]
  );

  const dismissTask = (task) => {
    if (task.source === "job") {
      setHidden((prev) => new Set(prev).add(task.id));
    } else {
      dismiss(task.id);
    }
  };

  // "Nothing to report" belongs to the notice list below; a section header
  // over an empty list is decoration.
  if (!live.length) return null;

  return (
    <div className="border-b border-border-subtle">
      <div className="px-3.5 pt-3 pb-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          {live.some((t) => t.state !== "done") ? "Running in background" : "Completed"}
        </span>
      </div>
      <ul className="max-h-[min(180px,30vh)] overflow-y-auto custom-scrollbar">
        {live.map((task) => {
          const pct = percentOf(task.progress);
          // The message already carries the counts ("20/30 proxies"); the
          // fallbacks describe what is known instead of inventing a number.
          const finished = task.state === "done";
          const line =
            task.message || (finished ? "Completed" : pct !== null ? `${pct}%` : "Starting");
          const counts = /(\d+)\s*\/\s*(\d+)/.exec(task.message || "");
          const aria = [
            task.title || "Working",
            counts ? `${counts[1]} of ${counts[2]}` : null,
            pct !== null ? `${pct}%` : null,
            finished ? "completed" : task.state,
          ]
            .filter(Boolean)
            .join(", ");
          return (
            <li key={task.id} className="border-b border-border-subtle/60 last:border-0">
              <div className="group flex items-start">
                <button
                  type="button"
                  onClick={() => onPick?.(task)}
                  aria-label={aria}
                  className="block min-w-0 flex-1 text-left"
                >
                  <span className="flex items-start gap-2 px-3.5 py-2.5 transition-colors group-hover:bg-surface-2">
                  <span
                    className={`material-symbols-outlined text-[16px] mt-0.5 shrink-0 ${
                      finished ? "text-success" : "text-primary"
                    }`}
                  >
                    {finished ? "check_circle" : "progress_activity"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-xs font-medium text-text-main">
                        {task.title || "Working"}
                      </span>
                      <span
                        className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide ${
                          finished ? "text-success" : "text-text-muted"
                        }`}
                      >
                        {finished ? "Completed" : task.state}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] leading-tight text-text-muted">
                      {line}
                    </span>
                    <span className="mt-1.5 block h-1 overflow-hidden rounded bg-border">
                      {pct === null ? (
                        <span className="progress-indeterminate block h-full w-2/5 bg-primary" />
                      ) : (
                        <span
                          className={`block h-full transition-[width] duration-300 ${
                            finished ? "bg-success" : "bg-primary"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      )}
                    </span>
                  </span>
                    {pct !== null ? (
                      <span
                        className={`shrink-0 font-mono text-[11px] font-semibold tabular-nums ${
                          finished ? "text-success" : "text-primary"
                        }`}
                      >
                        {pct}%
                      </span>
                    ) : null}
                  </span>
                </button>
                <div className="flex shrink-0 items-center pr-2.5 py-2.5">
                  <button
                    type="button"
                    onClick={() => dismissTask(task)}
                    title="Remove"
                    aria-label={`Remove ${task.title || "task"}`}
                    className="flex size-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-text-main"
                  >
                    <span className="material-symbols-outlined text-[15px]">cancel</span>
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

NotifToast.propTypes = {
  /** Polled server jobs, merged in for runs no page has adopted. */
  jobs: PropTypes.arrayOf(
    PropTypes.shape({
      taskId: PropTypes.string,
      title: PropTypes.string,
      message: PropTypes.string,
      progress: PropTypes.number,
      status: PropTypes.string,
      href: PropTypes.string,
    })
  ),
  onPick: PropTypes.func,
};
