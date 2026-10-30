"use client";

import { parseModelReference } from "open-sse/utils/modelReference.js";
import { useTranslation } from "@/i18n/useTranslation";

export default function ModelReferenceLabel({ value, connections = [] }) {
  const t = useTranslation();
  const { model, connectionId } = parseModelReference(value);
  const connection = connectionId ? connections.find(item => item.id === connectionId) : null;
  const label = connection?.name?.trim() || connection?.displayName?.trim() || connection?.email?.trim() || connectionId?.slice(0, 8);
  return (
    <span data-i18n-skip className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1">
      <span className="min-w-0 truncate font-mono text-xs" title={model}>{model}</span>
      {connectionId && <span className="inline-flex max-w-40 shrink-0 items-center gap-1 rounded-md border border-primary/15 bg-primary/8 px-1.5 py-0.5 font-sans text-[11px] font-medium text-primary" title={`${t("Account")}: ${label}`}>
        <span aria-hidden="true" className="material-symbols-outlined text-[13px]">person</span>
        <span className="truncate">{label}</span>
      </span>}
    </span>
  );
}
