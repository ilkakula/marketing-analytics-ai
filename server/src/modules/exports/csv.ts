// CSV injection: Excel/Sheets execute cells starting with = + - @ as formulas.
// Campaign names come from users (from imported CSVs), so we neutralize them with an apostrophe.
const DANGEROUS_START = /^[=+\-@\t\r]/;

export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v); // numbers are ours (non-negative), they cannot become a formula
  const safe = DANGEROUS_START.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(header: string[], rows: Array<Array<string | number | null>>): string {
  // BOM so Excel reads UTF-8 correctly (non-ASCII characters).
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
