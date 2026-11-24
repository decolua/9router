import { Badge, Input, Select } from "@/shared/components";
import { ProjectBadge, ProjectFilter } from "@/shared/components/KeyProject";
import { keyStatus, maskKey } from "@/shared/utils/apiKeyList";
import { translate } from "@/i18n/runtime";
import { QuotaBar } from "./KeyRequestQuotas";

const variants = { Active: "success", Paused: "warning", Expired: "error" };
const statuses = ["All", ...Object.keys(variants), "Restricted"];

function ListItem({ apiKey, selected, onSelect, windows, now }) {
  const status = keyStatus(apiKey, now);
  const count = apiKey.allowedConnections?.length || 0;
  const fullest = Object.values(windows || {})
    .filter((w) => w.limit > 0)
    .sort((a, b) => b.used / b.limit - a.used / a.limit)[0];

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={(event) => onSelect(apiKey.id, event.currentTarget)}
      className={`block w-full min-w-0 rounded-xl border p-3.5 text-start transition-colors focus-visible:outline-primary ${
        selected
          ? "border-primary bg-primary/5"
          : "border-border bg-surface hover:border-primary/50 hover:bg-surface-2"
      }`}
    >
      <span className="flex items-start justify-between gap-2">
        <strong data-i18n-skip className="min-w-0 break-words text-sm">
          {apiKey.name}
        </strong>
        <Badge size="sm" dot={status === "Active"} variant={variants[status]} className="shrink-0">
          {status}
        </Badge>
      </span>
      {(apiKey.project || apiKey.owner) && (
        <span className="mt-1 flex flex-wrap items-center gap-2 break-all text-xs text-text-muted">
          <ProjectBadge project={apiKey.project} />
          <span data-i18n-skip>{apiKey.owner}</span>
        </span>
      )}
      <code className="mt-2 block text-xs text-text-muted">{maskKey(apiKey.key)}</code>
      <span className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-2 text-xs text-text-muted">
        <span>
          <span>Accounts</span>:{" "}
          {count ? (
            <span data-i18n-skip>{`${count} ${translate(count === 1 ? "account" : "accounts")}`}</span>
          ) : (
            <span>All</span>
          )}
        </span>
        <span>
          <span>Model access</span>: <span>{apiKey.access?.restricted ? "Restricted" : "Open"}</span>
        </span>
      </span>
      {fullest && (
        <span className="mt-2 block">
          <QuotaBar name={translate("Request quotas")} {...fullest} />
        </span>
      )}
    </button>
  );
}

export default function KeyList({ keys, filtered, filters, onFilter, activeId, onSelect, quotas, now }) {
  return (
    <div className="min-w-0 space-y-3">
      <Input
        icon="search"
        type="search"
        placeholder={translate("Search keys")}
        aria-label={translate("Search keys")}
        value={filters.search}
        onChange={(event) => onFilter("search", event.target.value)}
      />
      <div className="grid grid-cols-2 gap-2">
        <Select
          label="Status"
          aria-label={translate("Status")}
          value={filters.status}
          placeholder=""
          selectClassName="[&>option:first-child]:hidden"
          options={statuses.map((value) => ({ value, label: value }))}
          onChange={(event) => onFilter("status", event.target.value)}
        />
        <ProjectFilter
          keys={keys}
          value={filters.project}
          onChange={(value) => onFilter("project", value)}
          stacked
        />
      </div>
      <div className="space-y-2 lg:max-h-[max(18rem,calc(100dvh-15rem))] lg:overflow-y-auto lg:p-1">
        {filtered.map((apiKey) => (
          <ListItem
            key={apiKey.id}
            apiKey={apiKey}
            selected={activeId === apiKey.id}
            onSelect={onSelect}
            windows={quotas[apiKey.id]}
            now={now}
          />
        ))}
        {!filtered.length && <p className="p-4 text-center text-sm text-text-muted">No matching keys</p>}
      </div>
    </div>
  );
}
