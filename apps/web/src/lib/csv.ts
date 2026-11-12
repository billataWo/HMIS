/**
 * Reads a CSV file as Excel and Google Sheets save it: quoted fields with commas, line breaks and
 * doubled quotes inside, CRLF line ends, a UTF-8 byte-order mark, and ";" as the separator where
 * the computer's region uses it.
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === sep) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  // Blank lines (often at the end) are not rows.
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/**
 * A price as typed in a spreadsheet: "1,250.00 ETB" (comma for thousands) or "2,50" (a decimal
 * comma, as some computers save it). A comma followed by one or two digits is a decimal point.
 */
export function money(raw: string) {
  const s = raw.trim().replace(/\s*(etb|birr|br)\.?$/i, "").replace(/\s/g, "");
  return /^\d+,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
}

/** A cell for a CSV file: quoted when it holds a separator, quote or line break. */
export const csvCell = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
