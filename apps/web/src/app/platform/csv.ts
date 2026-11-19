import "server-only";

type Cell = string | number | boolean | null | undefined;

/**
 * One cell. Quoted when it must be; and a cell that would start a formula in Excel or Sheets
 * (=, +, -, @, tab, return: a clinic's name is typed by the clinic) gets a ' first, so it opens
 * as text.
 */
function cell(v: Cell) {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A CSV file to download. The byte-order mark makes Excel read the Amharic names correctly. */
export function csvResponse(filename: string, header: string[], rows: Cell[][]) {
  const body = [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
  return new Response(`﻿${body}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** A date as YYYY-MM-DD in Addis Ababa (what a spreadsheet sorts and reads). */
export const csvDate = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Addis_Ababa" }).format(new Date(iso)) : "");

/** Today, for the file name. */
export const today = () => csvDate(new Date().toISOString());
