import { CLINIC_TZ, EN, formatMinutes } from "@/lib/format";
import type { T } from "@/lib/i18n";
import type { ReportColumn } from "@/lib/reports";

type Cell = string | number | null | undefined;

const dateTime = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: CLINIC_TZ });
const dateOnly = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: CLINIC_TZ });
const isoDay = new Intl.DateTimeFormat("en-CA", { timeZone: CLINIC_TZ });
const isoTime = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: CLINIC_TZ });

/** A cell as the page shows it ("—" for nothing). */
export function showCell(col: ReportColumn, v: Cell, t: T = EN): string {
  if (v === null || v === undefined || v === "") return "—";
  switch (col.type) {
    case "money":
      return Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case "number":
      return Number(v).toLocaleString("en-US");
    case "datetime":
      return dateTime.format(new Date(String(v)));
    case "date":
      return dateOnly.format(new Date(String(v)));
    case "minutes":
      return formatMinutes(Number(v), t);
    case "age":
      return t("{n} y", { n: v });
    case "days":
      return Number(v) < 0 ? t("expired {n} days ago", { n: -Number(v) }) : t("{n} days", { n: v });
    case "choice":
      return t(col.choices?.find((c) => c.value === v)?.label ?? String(v));
    default:
      return String(v);
  }
}

/** A cell for a spreadsheet: plain numbers, sortable dates (Addis Ababa time), names in English. */
export function csvCell(col: ReportColumn, v: Cell): string | number | null {
  if (v === null || v === undefined || v === "") return null;
  switch (col.type) {
    case "money":
    case "number":
    case "minutes":
    case "age":
    case "days":
      return Number(v);
    case "datetime": {
      const d = new Date(String(v));
      return `${isoDay.format(d)} ${isoTime.format(d)}`;
    }
    case "date":
      return isoDay.format(new Date(String(v)));
    case "choice":
      return col.choices?.find((c) => c.value === v)?.label ?? String(v);
    default:
      return String(v);
  }
}

/** Numbers line up on the right. */
export const numeric = (col: ReportColumn) => col.type === "money" || col.type === "number" || col.type === "minutes" || col.type === "age" || col.type === "days";

/** Sorts rows by a column (numbers as numbers, the rest as text), empty cells last. */
export function sortRows<R extends Record<string, Cell>>(rows: R[], col: ReportColumn, dir: "asc" | "desc") {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[col.key];
    const y = b[col.key];
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    return (numeric(col) ? Number(x) - Number(y) : String(x).localeCompare(String(y))) * sign;
  });
}
