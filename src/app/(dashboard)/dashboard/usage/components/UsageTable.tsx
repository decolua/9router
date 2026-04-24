"use client";

import React, { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import { CaretRight as ChevronRight, ArrowsDownUp as ArrowUpDown, ArrowUp, ArrowDown } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { translate } from "@/i18n/runtime";

const fmt = (n: number | string) => new Intl.NumberFormat().format(Number(n) || 0);
const fmtCost = (n: number | string) => `$${(Number(n) || 0).toFixed(4)}`;

function fmtTime(iso: string) {
 if (!iso) return translate("Never");
 const diffMins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
 if (diffMins < 1) return translate("Just now");
 if (diffMins < 60) return `${diffMins}M ${translate("ago")}`;
 if (diffMins < 1440) return `${Math.floor(diffMins / 60)}H ${translate("ago")}`;
 return new Date(iso).toLocaleDateString();
}

interface SortIconProps {
  field: string;
  currentSort: string;
  currentOrder: "asc" | "desc";
}

function SortIcon({ field, currentSort, currentOrder }: SortIconProps) {
 if (currentSort !== field) return <ArrowUpDown className="size-3 ml-1 opacity-20 inline" weight="bold" />;
 return currentOrder === "asc"
 ? <ArrowUp className="size-3 ml-1 inline text-primary" weight="bold" /> 
 : <ArrowDown className="size-3 ml-1 inline text-primary" weight="bold" />;
}

interface ValueCellsProps {
  item: any;
  viewMode: "tokens" | "cost";
  isSummary?: boolean;
}

function ValueCells({ item, viewMode, isSummary = false }: ValueCellsProps) {
  if (viewMode === "tokens") {
    return (
      <>
        <td className="px-3 py-2 text-right text-muted-foreground text-[10px] font-bold uppercase tracking-widest opacity-40 tabular-nums">
          {isSummary && item.promptTokens === undefined ? "—" : fmt(item.promptTokens)}
        </td>
        <td className="px-3 py-2 text-right text-muted-foreground text-[10px] font-bold uppercase tracking-widest opacity-40 tabular-nums">
          {isSummary && item.completionTokens === undefined ? "—" : fmt(item.completionTokens)}
        </td>
        <td className="px-3 py-2 text-right text-xs font-bold tabular-nums text-foreground">
          {fmt(item.totalTokens)}
        </td>
      </>
    );
  }
  return (
    <>
      <td className="px-3 py-2 text-right text-muted-foreground text-[10px] font-bold uppercase tracking-widest opacity-40 tabular-nums">
        {isSummary && item.inputCost === undefined ? "—" : fmtCost(item.inputCost)}
      </td>
      <td className="px-3 py-2 text-right text-muted-foreground text-[10px] font-bold uppercase tracking-widest opacity-40 tabular-nums">
        {isSummary && item.outputCost === undefined ? "—" : fmtCost(item.outputCost)}
      </td>
      <td className="px-3 py-2 text-right text-xs font-bold text-foreground tabular-nums">
        {fmtCost(item.totalCost || item.cost)}
      </td>
    </>
  );
}

interface Column {
  field: string;
  label: string;
  align?: "left" | "right";
}

interface UsageTableProps {
  columns: Column[];
  groupedData: any[];
  tableType: string;
  sortBy: string;
  sortOrder: "asc" | "desc";
  onToggleSort: (tableType: string, field: string) => void;
  viewMode: "tokens" | "cost";
  storageKey: string;
  renderDetailCells: (item: any) => React.ReactNode;
  renderSummaryCells: (group: any) => React.ReactNode;
  emptyMessage: string;
}

/**
 * Reusable sortable usage table with expandable group rows.
 */
export default function UsageTable({
 columns,
 groupedData,
 tableType,
 sortBy,
 sortOrder,
 onToggleSort,
 viewMode,
 storageKey,
 renderDetailCells,
 renderSummaryCells,
 emptyMessage,
}: UsageTableProps) {
 const [expanded, setExpanded] = useState<Set<string>>(new Set());

 // Load expanded state from localStorage
 useEffect(() => {
 try {
 const saved = localStorage.getItem(storageKey);
 if (saved) setExpanded(new Set(JSON.parse(saved)));
 } catch (e) {
 console.error(`Failed to load ${storageKey}:`, e);
 }
 }, [storageKey]);

 // Save expanded state to localStorage
 useEffect(() => {
 try {
 localStorage.setItem(storageKey, JSON.stringify([...expanded]));
 } catch (e) {
 console.error(`Failed to save ${storageKey}:`, e);
 }
 }, [expanded, storageKey]);

 const toggleGroup = useCallback((groupKey: string) => {
 setExpanded((prev) => {
 const next = new Set(prev);
 next.has(groupKey) ? next.delete(groupKey) : next.add(groupKey);
 return next;
 });
 }, []);

 const valueColumns = useMemo(() => {
 if (viewMode === "tokens") {
 return [
 { field: "promptTokens", label: translate("In") },
 { field: "completionTokens", label: translate("Out") },
 { field: "totalTokens", label: translate("Total") },
 ];
 }
 return [
 { field: "promptTokens", label: translate("In") },
 { field: "completionTokens", label: translate("Out") },
 { field: "cost", label: translate("Total") },
 ];
 }, [viewMode]);

 const totalColSpan = columns.length + valueColumns.length;

 return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left border-collapse">
        <thead className="bg-muted/10 text-muted-foreground text-[9px] font-bold uppercase tracking-[0.2em] border-b border-border/50">
          <tr>
            {columns.map((col) => (
              <th
                key={col.field}
                className={cn(
                  "px-3 py-3 cursor-pointer hover:bg-muted/20 transition-colors whitespace-nowrap",
                  col.align === "right" ? "text-right" : ""
                )}
                onClick={() => onToggleSort(tableType, col.field)}
              >
                <div className={cn("flex items-center gap-1", col.align === "right" && "justify-end")}>
                  {col.label}
                  <SortIcon field={col.field} currentSort={sortBy} currentOrder={sortOrder} />
                </div>
              </th>
            ))}
            {valueColumns.map((col) => (
              <th
                key={col.field}
                className="px-3 py-3 text-right cursor-pointer hover:bg-muted/20 transition-colors whitespace-nowrap"
                onClick={() => onToggleSort(tableType, col.field)}
              >
                <div className="flex items-center justify-end gap-1">
                  {col.label}
                  <SortIcon field={col.field} currentSort={sortBy} currentOrder={sortOrder} />
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/20">
          {groupedData.map((group) => (
            <Fragment key={group.groupKey}>
              {/* Group summary row */}
              <tr
                className="group-summary cursor-pointer hover:bg-muted/30 transition-colors bg-background"
                onClick={() => toggleGroup(group.groupKey)}
              >
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <ChevronRight className={cn(
                      "size-3 text-muted-foreground transition-transform",
                      expanded.has(group.groupKey) && "rotate-90 text-primary"
                    )} weight="bold" />
                    <span className={cn(
                      "text-xs font-bold tracking-tight",
                      group.summary.pending > 0 && "text-primary",
                      expanded.has(group.groupKey) && "text-primary"
                    )}>
                      {group.groupKey}
                    </span>
                  </div>
                </td>
                {renderSummaryCells(group)}
                <ValueCells item={group.summary} viewMode={viewMode} isSummary />
              </tr>
              {/* Detail rows */}
              {expanded.has(group.groupKey) && group.items.map((item: any) => (
                <tr
                  key={`detail-${item.key}`}
                  className="group-detail bg-muted/5 hover:bg-muted/10 transition-colors"
                >
                  {renderDetailCells(item)}
                  <ValueCells item={item} viewMode={viewMode} />
                </tr>
              ))}
            </Fragment>
          ))}
          {groupedData.length === 0 && (
            <tr>
              <td colSpan={totalColSpan} className="px-3 py-12 text-center text-muted-foreground font-bold uppercase tracking-[0.2em] italic opacity-30 text-xs">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
 );
}

export { fmt, fmtCost, fmtTime };
