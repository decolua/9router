"use client";

import { Input } from "@/shared/components";

/** Reusable endpoint row component */
export default function EndpointRow({ label, url, copyId, copied, onCopy, badge, actions }) {
  return (
    <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
      <span
        title={label}
        className={`text-xs font-mono px-2 py-1 rounded shrink-0 min-w-[64px] sm:min-w-[84px] text-center font-medium ${
          (badge === "CF" || badge === "TS") ? "bg-primary/10 text-primary" : "bg-surface-2 text-text-muted"
        }`}
      >
        {label}
      </span>
      <Input value={url} readOnly className="flex-1 min-w-0 font-mono text-xs sm:text-sm" inputClassName="truncate" />
      <button
        onClick={() => onCopy(url, copyId)}
        className="p-1.5 sm:p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-colors shrink-0"
        aria-label={`Copy ${label} URL`}
      >
        <span className="material-symbols-outlined text-[18px]">{copied === copyId ? "check" : "content_copy"}</span>
      </button>
      {actions}
    </div>
  );
}
