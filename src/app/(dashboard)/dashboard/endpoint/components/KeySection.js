import { Children, useId } from "react";

// The icon font's line box sits low in a grid cell; centre a separate glyph span instead.
function SectionIcon({ icon }) {
  return (
    <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
      <span className="material-symbols-outlined block text-[20px] leading-none">{icon}</span>
    </span>
  );
}

function Heading({ title, description, icon }) {
  return (
    <div className="flex min-w-0 grow basis-64 items-start gap-3 text-start">
      <SectionIcon icon={icon} />
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-text-main">{title}</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{description}</p>
      </div>
    </div>
  );
}

/**
 * A detail-panel section. With `collapsible`, the header toggles the body
 * (controlled through `open` / `onToggle`) and the summary in `action` stays visible.
 */
export default function KeySection({ title, description, icon, action, children, collapsible = false, open = true, onToggle }) {
  const bodyId = useId();
  const hasBody = Children.toArray(children).length > 0;

  if (!collapsible) {
    return (
      <section className="min-w-0 rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Heading title={title} description={description} icon={icon} />
          {action}
        </div>
        {hasBody && <div className="mt-4">{children}</div>}
      </section>
    );
  }

  return (
    <section className="min-w-0 rounded-xl border border-border bg-surface">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => onToggle?.(!open)}
        className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl p-4 transition-colors hover:bg-surface-2/50"
      >
        <Heading title={title} description={description} icon={icon} />
        <span className="flex shrink-0 items-center gap-2">
          {action}
          <span aria-hidden="true" className="material-symbols-outlined text-[20px] leading-none text-text-muted">
            {open ? "expand_less" : "expand_more"}
          </span>
        </span>
      </button>
      <div id={bodyId} hidden={!open} className="border-t border-border p-4">
        {children}
      </div>
    </section>
  );
}
