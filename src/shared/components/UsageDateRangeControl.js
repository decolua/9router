"use client";

import PropTypes from "prop-types";
import SegmentedControl from "./SegmentedControl";
import { cn } from "@/shared/utils/cn";

export const USAGE_PERIODS = [
  { value: "today", label: "今天" },
  { value: "24h", label: "最近 24 小时" },
  { value: "7d", label: "1 周" },
  { value: "30d", label: "1 个月" },
  { value: "custom", label: "自定义" },
];

export function toLocalDateTimeValue(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function getPeriodRange(period, now = new Date(), todayEndsTomorrow = false) {
  const end = new Date(now);
  let start = new Date(now);
  if (period === "today") {
    start.setHours(0, 0, 0, 0);
    if (todayEndsTomorrow) {
      end.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() + 1);
    }
  } else if (period === "24h") {
    start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  } else if (period === "7d") {
    start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (period === "30d") {
    start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
  return { startDate: toLocalDateTimeValue(start), endDate: toLocalDateTimeValue(end) };
}

export default function UsageDateRangeControl({
  period,
  startDate,
  endDate,
  onPeriodChange,
  onStartDateChange,
  onEndDateChange,
  todayEndsTomorrow = false,
  className,
}) {
  const selectPeriod = (value) => {
    if (value === "custom") {
      onPeriodChange("custom");
      return;
    }
    const range = getPeriodRange(value, new Date(), todayEndsTomorrow);
    onStartDateChange(range.startDate, false);
    onEndDateChange(range.endDate, false);
    onPeriodChange(value);
  };

  const changeDate = (callback) => (event) => {
    callback(event.target.value, true);
    onPeriodChange("custom");
  };

  const inputClass = "h-9 min-w-0 rounded-md border border-border bg-surface px-2 text-xs text-text-main outline-none focus:border-primary focus:ring-2 focus:ring-primary/15";

  return (
    <div className={cn("flex min-w-0 flex-col gap-2 xl:flex-row xl:items-center", className)}>
      <SegmentedControl options={USAGE_PERIODS} value={period} onChange={selectPeriod} size="sm" className="w-full xl:w-auto" />
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-md bg-surface p-1">
        <input type="datetime-local" value={startDate} onChange={changeDate(onStartDateChange)} className={inputClass} aria-label="开始时间" />
        <span className="text-xs text-text-muted">至</span>
        <input type="datetime-local" value={endDate} onChange={changeDate(onEndDateChange)} className={inputClass} aria-label="结束时间" />
      </div>
    </div>
  );
}

UsageDateRangeControl.propTypes = {
  period: PropTypes.string.isRequired,
  startDate: PropTypes.string.isRequired,
  endDate: PropTypes.string.isRequired,
  onPeriodChange: PropTypes.func.isRequired,
  onStartDateChange: PropTypes.func.isRequired,
  onEndDateChange: PropTypes.func.isRequired,
  todayEndsTomorrow: PropTypes.bool,
  className: PropTypes.string,
};
