"use client";

import { useId, useRef } from "react";

// Small "i" button with a native popover: click, keyboard, Esc and tap-outside work without JS state.
// ponytail: positions on open only; a scroll while open leaves it in place. Use CSS anchor positioning when all browsers ship it.
export default function InfoTip({ title, children, label }) {
  const id = useId().replace(/:/g, "");
  const btn = useRef(null);
  const place = e => {
    if (e.newState !== "open" || !btn.current) return;
    const r = btn.current.getBoundingClientRect(), el = e.currentTarget, w = Math.min(288, window.innerWidth - 32);
    // The UA popover style centers with inset:0 and margin:auto; pin it to the button instead.
    Object.assign(el.style, { margin: "0", right: "auto", bottom: "auto", width: `${w}px` });
    el.style.left = `${Math.max(16, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 16))}px`;
    const below = r.bottom + 8, h = el.offsetHeight;
    el.style.top = `${below + h > window.innerHeight - 8 && r.top - h - 8 > 8 ? r.top - h - 8 : below}px`;
  };
  return (
    <>
      <button
        ref={btn}
        type="button"
        popoverTarget={id}
        aria-label={label || `About ${title}`}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full align-middle text-text-muted hover:text-text-main hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 cursor-help"
      >
        <span className="material-symbols-outlined text-[15px]" aria-hidden="true">info</span>
      </button>
      <div
        id={id}
        popover="auto"
        onToggle={place}
        className="fixed m-0 rounded-[10px] border border-border bg-surface p-3 text-xs leading-relaxed text-text-muted shadow-[var(--shadow-elev)]"
      >
        {title && <p className="mb-1 font-semibold text-text-main">{title}</p>}
        <div className="space-y-1.5">{children}</div>
      </div>
    </>
  );
}
