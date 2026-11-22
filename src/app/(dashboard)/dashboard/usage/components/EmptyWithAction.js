/**
 * Empty state for a data view: says what is missing and offers the one action
 * that fills it. A bare "no data" leaves the user hunting for the button that
 * creates it, which on most of these pages lives on a different screen.
 */
export default function EmptyWithAction({ icon = "inbox", title, hint, actionHref, actionLabel, secondaryHref, secondaryLabel }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center">
      <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
        <span className="material-symbols-outlined text-[28px]">{icon}</span>
      </div>
      <div>
        <p className="text-text-main font-medium">{title}</p>
        {hint && <p className="mt-1 text-sm text-text-muted">{hint}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {actionHref && (
          <a
            href={actionHref}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <span className="material-symbols-outlined text-[18px]">add_circle</span>
            {actionLabel}
          </a>
        )}
        {secondaryHref && (
          <a
            href={secondaryHref}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm text-text transition-colors hover:bg-bg-hover"
          >
            {secondaryLabel}
          </a>
        )}
      </div>
    </div>
  );
}
