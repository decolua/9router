// ponytail: stdlib JS Date covers calendar ranges; upgrade to @date-fns if multi-tz needed

export const PRESETS = [
  { id: "15m", short: "15m", label: "Past 15 Minutes", section: "rolling" },
  { id: "30m", short: "30m", label: "Past 30 Minutes", section: "rolling" },
  { id: "1h", short: "1h", label: "Past 1 Hour", section: "rolling" },
  { id: "3h", short: "3h", label: "Past 3 Hours", section: "rolling" },
  { id: "24h", short: "1d", label: "Past 24 Hours", section: "rolling" },
  { id: "48h", short: "2d", label: "Past 48 Hours", section: "rolling" },
  { id: "7d", short: "1w", label: "Past 1 Week", section: "rolling" },
  { id: "30d", short: "1mo", label: "Past 30 Days", section: "rolling" },
  { id: "90d", short: "3mo", label: "Past 90 Days", section: "rolling" },
  { id: "today", short: "today", label: "Today", section: "calendar" },
  { id: "yesterday", short: "1d", label: "Yesterday", section: "calendar" },
  { id: "thisWeek", short: "thisWeek", label: "This Week", section: "calendar" },
  { id: "prevWeek", short: "7d", label: "Prev Week", section: "calendar" },
  { id: "thisMonth", short: "thisMonth", label: "This Month", section: "calendar" },
  { id: "prevMonth", short: "1mo", label: "Prev Month", section: "calendar" },
];

const ROLLING_MS = {
  "15m": 15 * 60 * 1000,
  "30m": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "3h": 3 * 3600 * 1000,
  "24h": 24 * 3600 * 1000,
  "48h": 48 * 3600 * 1000,
  "7d": 7 * 86400 * 1000,
  "30d": 30 * 86400 * 1000,
  "90d": 90 * 86400 * 1000,
};

const ENDS_AT_NOW_SET = new Set([
  "15m",
  "30m",
  "1h",
  "3h",
  "24h",
  "48h",
  "7d",
  "30d",
  "90d",
  "today",
  "thisWeek",
  "thisMonth",
]);

const VALID_PRESET_IDS = new Set([
  ...PRESETS.map((p) => p.id),
  "custom",
]);

export function isValidPreset(id) {
  return typeof id === "string" && VALID_PRESET_IDS.has(id);
}

export function endsAtNow(preset) {
  return ENDS_AT_NOW_SET.has(preset);
}

export function computeRange(preset, customFrom, customTo, now = Date.now()) {
  const n = typeof now === "number" ? now : new Date(now).getTime();

  if (preset === "custom") {
    const f = Number(customFrom);
    const t = Number(customTo);
    if (customFrom != null && customTo != null && Number.isFinite(f) && Number.isFinite(t)) {
      return { from: f, to: t };
    }
    return { from: n - 24 * 3600 * 1000, to: n };
  }

  if (preset === "today") {
    const d = new Date(n);
    d.setHours(0, 0, 0, 0);
    return { from: d.getTime(), to: n };
  }

  if (preset === "yesterday") {
    const today = new Date(n);
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return { from: yesterday.getTime(), to: today.getTime() };
  }

  if (preset === "thisWeek") {
    const d = new Date(n);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day; // Monday start
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return { from: d.getTime(), to: n };
  }

  if (preset === "prevWeek") {
    const d = new Date(n);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    const thisMonday = d.getTime();
    d.setDate(d.getDate() - 7);
    return { from: d.getTime(), to: thisMonday };
  }

  if (preset === "thisMonth") {
    const d = new Date(n);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return { from: d.getTime(), to: n };
  }

  if (preset === "prevMonth") {
    const thisMonth = new Date(n);
    thisMonth.setDate(1);
    thisMonth.setHours(0, 0, 0, 0);
    const prevMonth = new Date(thisMonth);
    prevMonth.setMonth(prevMonth.getMonth() - 1);
    return { from: prevMonth.getTime(), to: thisMonth.getTime() };
  }

  const ms = ROLLING_MS[preset] || 24 * 3600 * 1000;
  return { from: n - ms, to: n };
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function rangeLabel(preset, customFrom, customTo) {
  if (preset === "custom") {
    const f = Number(customFrom);
    const t = Number(customTo);
    if (customFrom != null && customTo != null && Number.isFinite(f) && Number.isFinite(t)) {
      const fromDate = new Date(f);
      const toDate = new Date(t);
      const pad = (v) => String(v).padStart(2, "0");
      const fmt = (d) => `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      return `${fmt(fromDate)} – ${fmt(toDate)}`;
    }
    return "custom";
  }

  const found = PRESETS.find((p) => p.id === preset);
  return found ? found.label.toLowerCase() : "past 24 hours";
}

export function getPresetBadge(id, now = Date.now()) {
  const n = typeof now === "number" ? now : new Date(now).getTime();
  const d = new Date(n);

  if (id === "today") {
    return `${d.getHours()}h`;
  }
  if (id === "thisWeek") {
    const day = d.getDay();
    const dayOfWeek = day === 0 ? 7 : day;
    return `${dayOfWeek}d`;
  }
  if (id === "thisMonth") {
    return `${d.getDate()}d`;
  }
  if (id === "yesterday") {
    return "24h"; // calendar presets show their span, as OpenRouter does; rolling "Past 24 Hours" shows "1d"
  }
  if (id === "prevWeek") {
    return "7d";
  }
  if (id === "prevMonth") {
    const prevMonthEnd = new Date(d.getFullYear(), d.getMonth(), 0);
    return `${prevMonthEnd.getDate()}d`;
  }

  const found = PRESETS.find((p) => p.id === id);
  return found ? found.short : id;
}
