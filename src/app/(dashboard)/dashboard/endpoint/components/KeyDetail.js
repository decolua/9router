import { useState } from "react";
import { Button, Toggle, Tooltip } from "@/shared/components";
import { getCurrentLocale, translate } from "@/i18n/runtime";
import { maskKey } from "@/shared/utils/apiKeyList";
import { KeyEditButton, KeyEditForm } from "./KeyOwnership";
import KeyAccessControls from "./KeyAccessControls";
import KeyAccounts from "./KeyAccounts";
import KeyExpiry from "./KeyExpiry";
import KeyRequestQuotas from "./KeyRequestQuotas";
import KeySection from "./KeySection";

function IconButton({ label, icon, danger, ...props }) {
  return (
    <Tooltip text={label}>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        icon={icon}
        aria-label={translate(label)}
        className={`size-9 p-0 ${danger ? "text-danger hover:bg-danger/10 hover:text-danger" : ""}`}
        {...props}
      />
    </Tooltip>
  );
}

function Usage({ rows, id }) {
  const row = Array.isArray(rows) && rows.find((item) => item.id === id);
  const locale = getCurrentLocale();
  const metrics = row && [
    ["Requests", row.requests.toLocaleString(locale)],
    ["Tokens", row.tokens.toLocaleString(locale)],
    [
      "Estimated cost",
      row.cost.toLocaleString(locale, { style: "currency", currency: "USD", maximumFractionDigits: 6 }),
    ],
    ["Error rate", row.errorRate.toLocaleString(locale, { style: "percent", maximumFractionDigits: 2 })],
  ];

  return (
    <KeySection
      icon="monitoring"
      title="Usage (last 7 days)"
      description="Requests, tokens, cost and errors."
    >
      {metrics ? (
        <dl className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          {metrics.map(([label, value]) => (
            <div key={label} className="min-w-0 rounded-lg bg-surface-2 px-3 py-2">
              <dt className="text-xs text-text-muted">{label}</dt>
              <dd className="mt-1 break-words text-base font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p role="status" className="text-sm text-text-muted">
          {rows === false
            ? "Could not load usage"
            : rows === null
              ? "Loading"
              : "No usage in this period"}
        </p>
      )}
    </KeySection>
  );
}

export default function KeyDetail({
  apiKey,
  onSaved,
  connections,
  reloadConnections,
  isAdmin,
  usage,
  now,
  windows,
  reloadQuotas,
  visibleKeys,
  toggleKeyVisibility,
  copied,
  copy,
  onToggle,
  rotating,
  onRotate,
  onDelete,
  onAccess,
  onRestrict,
}) {
  const showing = visibleKeys.has(apiKey.id);
  const [editing, setEditing] = useState(false);
  return (
    <div className="min-w-0 space-y-3">
      <header className="rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1">
              <h3 data-i18n-skip className="min-w-0 break-all text-lg font-semibold">
                {apiKey.name}
              </h3>
              {!editing && <KeyEditButton apiKey={apiKey} onEdit={() => setEditing(true)} />}
            </div>
            <p data-i18n-skip className="break-words text-sm text-text-muted">
              {[apiKey.owner, apiKey.project, apiKey.description].filter(Boolean).join(" · ")}
            </p>
            <p className="mt-1 text-xs text-text-muted">
              <span>Created</span>{" "}
              <time dateTime={apiKey.createdAt}>
                {new Date(apiKey.createdAt).toLocaleDateString(getCurrentLocale())}
              </time>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Toggle
              checked={apiKey.isActive ?? true}
              size="sm"
              className="me-2"
              aria-label={translate(apiKey.isActive === false ? "Resume key" : "Pause key")}
              onChange={(checked) => onToggle(apiKey, checked)}
            />
            <IconButton
              label="Rotate key"
              icon="autorenew"
              disabled={rotating}
              onClick={() => onRotate(apiKey)}
            />
            <IconButton
              label="Delete API Key"
              icon="delete"
              danger
              onClick={() => onDelete(apiKey.id)}
            />
          </div>
        </div>
        {editing && <KeyEditForm apiKey={apiKey} onSaved={onSaved} onClose={() => setEditing(false)} />}
        <div className="mt-4 flex items-center gap-1 rounded-lg border border-border bg-bg px-3 py-1">
          <code className="min-w-0 flex-1 break-all text-xs">
            {showing ? apiKey.key : maskKey(apiKey.key)}
          </code>
          <IconButton
            label={showing ? "Hide key" : "Show key"}
            icon={showing ? "visibility_off" : "visibility"}
            onClick={() => toggleKeyVisibility(apiKey.id)}
          />
          <IconButton
            label="Copy"
            icon={copied === apiKey.id ? "check" : "content_copy"}
            onClick={() => copy(apiKey.key, apiKey.id)}
          />
        </div>
      </header>
      {isAdmin && <Usage rows={usage} id={apiKey.id} />}
      <KeyAccounts
        apiKey={apiKey}
        connections={connections}
        reload={reloadConnections}
        onSaved={(allowedConnections) => onSaved({ allowedConnections })}
      />
      <KeyAccessControls
        apiKey={apiKey}
        onChange={(access) => onAccess(apiKey.id, access)}
        onRequestRestrict={() => onRestrict(apiKey)}
      />
      <KeyRequestQuotas keyId={apiKey.id} windows={windows} reload={reloadQuotas} onSaved={onSaved} />
      <KeyExpiry
        now={now}
        keyId={apiKey.id}
        expiresAt={apiKey.expiresAt}
        onSaved={(expiresAt) => onSaved({ expiresAt })}
      />
    </div>
  );
}
