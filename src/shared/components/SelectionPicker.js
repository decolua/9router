"use client";

// Presentation only. Callers own filtering, selection rules and data loading.
export function SelectionToolbar({ searchLabel, searchProps, searchIndicators, count, children }) {
  return (
    <div className="mb-3 space-y-2">
      <label className="block relative">
        <span className="sr-only">{searchLabel}</span>
        <span aria-hidden="true" className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted text-[16px]">search</span>
        <input {...searchProps} className="w-full pl-8 pr-20 py-1.5 bg-surface border border-border rounded text-xs focus:outline-none focus:ring-1 focus:ring-primary/50" />
        {searchIndicators && <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">{searchIndicators}</div>}
      </label>
      {count != null && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-text-muted">
          <span className="flex items-center gap-1.5">{count}</span>
          <div className="flex items-center gap-1.5">{children}</div>
        </div>
      )}
    </div>
  );
}

export function SelectionAction({ children, muted = false, ...props }) {
  return <button type="button" {...props} className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-50 ${muted ? "bg-border/40 text-text-muted hover:text-text-main hover:bg-border/60" : "bg-primary/10 text-primary hover:bg-primary/20"}`}>{children}</button>;
}

export function SelectionGroup({ as: Container = "div", headerAs: Header = "div", label, icon, name, count, color, children }) {
  return (
    <Container aria-label={label}>
      <Header className="flex items-center gap-1.5 mb-1.5 sticky top-0 bg-surface py-0.5 z-10" style={color ? { color } : undefined}>
        {icon}
        {name}
        <span className="text-[10px] text-text-muted">{count}</span>
      </Header>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </Container>
  );
}

export function SelectionChip({ selected, added, placeholder, children, ...props }) {
  return (
    <button
      type="button"
      {...props}
      className={`max-w-full px-2 py-1 rounded-xl text-left text-xs font-medium transition-all border hover:cursor-pointer ${placeholder
        ? "border-dashed border-border text-text-muted hover:border-primary/50 hover:text-primary bg-surface italic"
        : selected
          ? "bg-primary text-white border-primary"
          : added
            ? "bg-primary border-primary text-white hover:bg-primary-hover"
            : "bg-surface border-border text-text-main hover:border-primary/50 hover:bg-primary/5"
      }`}
    >
      {children}
    </button>
  );
}
