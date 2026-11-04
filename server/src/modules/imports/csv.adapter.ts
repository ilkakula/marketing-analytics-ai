import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import type { ImportRowError } from "../../database/models";
import { badRequest } from "../../shared/errors";
import { type AdMetric, UNASSIGNED, toExternalId } from "./adMetric";

export const MAX_ROWS = 50_000;

export const REQUIRED_FIELDS = ["date", "campaign", "spend", "impressions", "clicks", "conversions", "revenue"] as const;
export const OPTIONAL_FIELDS = ["ad_set", "ad"] as const;
const ALL_FIELDS = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];
export type Field = (typeof ALL_FIELDS)[number];

/** Mapping: our field -> column name in the user's file. */
export type ColumnMapping = Partial<Record<Field, string>>;
export const mappingSchema = z.partialRecord(z.enum(ALL_FIELDS), z.string().min(1));

/**
 * "Amount spent (USD)" -> "amount_spent", "Conv. value" -> "conv_value". The currency code in parentheses
 * varies per account, so it is dropped; everything else becomes lowercase words joined by underscores.
 */
export const normalizeHeader = (s: string) =>
  // Only an upper-case ISO code in parentheses is a currency; "(all)" in "Clicks (all)" is part of the name.
  s.replace(/\(\s*[A-Z]{3}\s*\)/g, " ").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

// Column names used by common exports, in priority order (the first match wins, and a column is used once).
// The field's own name always has top priority. "Results" in a Meta export is the campaign's chosen result
// (purchases, leads...), which is the closest thing to our `conversions`.
const ALIASES: Record<Field, string[]> = {
  date: ["day", "reporting_starts", "reporting_date", "report_date", "segments_date"],
  campaign: ["campaign_name"],
  ad_set: ["ad_set_name", "adset", "adset_name", "ad_group", "ad_group_name"],
  ad: ["ad_name", "creative", "creative_name"],
  spend: ["amount_spent", "cost", "total_spend", "total_spent"],
  impressions: ["impr"],
  clicks: ["link_clicks", "clicks_all", "all_clicks"],
  conversions: ["results", "purchases", "website_purchases", "total_conversions", "conv"],
  revenue: ["purchase_conversion_value", "website_purchases_conversion_value", "conv_value", "conversion_value", "total_conversion_value"],
};

export type DetectedKind = "standard" | "meta" | "google" | "saved" | "custom";
export interface Detected {
  kind: DetectedKind;
  /** field -> the column of the file it was read from (what the user would otherwise have to map by hand) */
  mapping: ColumnMapping;
  headerRow: number; // 1-based line of the header (exports often start with title lines)
}

function detectKind(norms: Set<string>): "meta" | "google" | "standard" {
  if (norms.has("amount_spent") || (norms.has("campaign_name") && (norms.has("link_clicks") || norms.has("results") || norms.has("ad_set_name")))) return "meta";
  if (norms.has("ad_group") || norms.has("conv_value") || (norms.has("cost") && norms.has("campaign"))) return "google";
  return "standard";
}

/** Field -> column index. Explicit mapping first, then the field's own name, then known aliases. */
function resolveColumns(header: string[], mapping: ColumnMapping): Map<Field, number> {
  const norms = header.map(normalizeHeader);
  const used = new Set<number>();
  const out = new Map<Field, number>();
  const take = (field: Field, wanted: string) => {
    const idx = norms.findIndex((n, i) => n === wanted && !used.has(i));
    if (idx >= 0) { used.add(idx); out.set(field, idx); return true; }
    return false;
  };
  for (const f of ALL_FIELDS) if (mapping[f]) take(f, normalizeHeader(mapping[f]!));
  for (const f of ALL_FIELDS) {
    if (out.has(f)) continue;
    for (const alias of [f, ...ALIASES[f]]) if (take(f, alias)) break;
  }
  return out;
}

/** Same set of columns (in any order) = same file layout, so a saved mapping can be reused. */
export const headerSignature = (header: string[]) =>
  createHash("sha1").update(header.map(normalizeHeader).filter(Boolean).sort().join("|")).digest("hex");

function decode(buffer: Buffer): string {
  // Excel's "Unicode text" and some Google Ads downloads are UTF-16 with a byte order mark.
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString("utf16le");
  return buffer.toString("utf8");
}

// ";" is common in European locales and tabs in "Unicode text" exports. We look at the first lines
// (exports often start with title lines that contain no delimiter at all).
function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/, 12);
  const count = (d: string) => lines.reduce((n, l) => n + (l.split(d).length - 1), 0);
  const best = [",", ";", "\t"].map((d) => ({ d, n: count(d) })).sort((a, b) => b.n - a.n)[0]!;
  return best.n > 0 ? best.d : ",";
}

// abort: a value that is not even shaped like a date gets one message, not two.
const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Date must be in YYYY-MM-DD format", abort: true }).refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, "Date does not exist");

const text = (max = 255) => z.string().trim().min(1, "Required field").max(max);
const decimal = z.string().regex(/^\d+(\.\d+)?$/, "Must be a non-negative number").transform(Number);
const integer = z.string().regex(/^\d+$/, "Must be a non-negative integer").transform(Number);

/**
 * Real exports carry currency symbols ("$1,234.50", "EUR 12"), thousands separators and "--" for "no data".
 * European files (";") use "1.234,50". Anything that is still not a plain number is reported as an error.
 */
export function cleanNumber(value: string, decimalComma: boolean): string {
  let s = value.trim().replace(/^[A-Za-z$€£\s]+|[A-Za-z$€£\s]+$/g, "");
  if (/^-{1,2}$/.test(s)) return "0"; // Google Ads marks "no data" with "--"
  if (decimalComma) {
    if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
    else if (/^\d+,\d+$/.test(s)) s = s.replace(",", ".");
  } else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  return s;
}

const rowSchema = z
  .object({
    date: dateField, campaign: text(), spend: decimal, impressions: integer,
    clicks: integer, conversions: integer, revenue: decimal,
    ad_set: z.string().trim().max(255).optional(), ad: z.string().trim().max(255).optional(),
  })
  .superRefine((r, ctx) => {
    if (r.clicks > r.impressions) {
      ctx.addIssue({ code: "custom", path: ["clicks"], message: "Clicks cannot exceed impressions" });
    }
  });

export interface ParsedCsv {
  metrics: Array<AdMetric & { row: number }>;
  errors: ImportRowError[];
  totalRows: number;
  detected: Detected;
  /** Identifies the file layout (see headerSignature) so the caller can save a mapping for it. */
  signature: string;
  /** The columns the data was actually read from, ready to be saved. */
  effectiveMapping: ColumnMapping;
}

export function parseCsv(buffer: Buffer, mapping: ColumnMapping = {}, saved: Map<string, ColumnMapping> = new Map()): ParsedCsv {
  const content = decode(buffer);
  if (!content.trim()) throw badRequest("The file is empty");
  const delimiter = detectDelimiter(content);

  let records: string[][];
  try {
    records = parse(content, { delimiter, bom: true, skip_empty_lines: true, relax_column_count: true, relax_quotes: true, trim: true });
  } catch (e) {
    throw badRequest(`The CSV could not be read: ${(e as Error).message}`);
  }

  // Exports often begin with title lines ("Campaign performance", the date range...). The header is the row
  // among the first lines that we can recognize the most columns in; with no clear winner it is the first row.
  let headerAt = 0;
  let best = resolveColumns(records[0] ?? [], mapping).size;
  for (let i = 1; i < Math.min(10, records.length); i++) {
    const n = resolveColumns(records[i]!, mapping).size;
    if (n > best) { best = n; headerAt = i; }
  }
  const header = records[headerAt] ?? [];
  const body = records.slice(headerAt + 1);
  if (body.length === 0) throw badRequest("The file has no data rows");
  if (body.length > MAX_ROWS) throw badRequest(`The file has too many rows (max ${MAX_ROWS})`);

  const signature = headerSignature(header);
  const savedMapping = saved.get(signature);
  const explicit = Object.keys(mapping).length > 0;
  const colIndex = resolveColumns(header, { ...savedMapping, ...mapping }); // explicit beats saved beats aliases
  const effectiveMapping: ColumnMapping = Object.fromEntries([...colIndex].map(([f, i]) => [f, header[i]!]));
  const kind: DetectedKind = explicit ? "custom" : savedMapping ? "saved" : detectKind(new Set(header.map(normalizeHeader)));
  const detected: Detected = { kind, mapping: effectiveMapping, headerRow: headerAt + 1 };

  const missing = REQUIRED_FIELDS.filter((f) => !colIndex.has(f));
  if (missing.length) {
    throw badRequest(`Missing required columns: ${missing.join(", ")}`, {
      missing, foundColumns: header, detected: effectiveMapping, hint: "Use the 'mapping' field to map your column names.",
    });
  }

  const decimalComma = delimiter === ";";
  const errors: ImportRowError[] = [];
  const metrics: ParsedCsv["metrics"] = [];
  const seen = new Map<string, number>();
  let totalRows = 0;
  const NUMERIC = new Set<Field>(["spend", "impressions", "clicks", "conversions", "revenue"]);

  body.forEach((cells, i) => {
    const rowNo = headerAt + 1 + i + 1; // 1-based line number in the file
    const firstFilled = cells.find((c) => c !== "");
    // Blank lines and the "Total" summary row at the bottom of Google Ads exports are not data.
    if (firstFilled === undefined || /^total\b/i.test(firstFilled)) return;
    totalRows++;

    const raw: Record<string, string> = {};
    for (const [f, idx] of colIndex) {
      const v = cells[idx] ?? "";
      raw[f] = NUMERIC.has(f) ? cleanNumber(v, decimalComma) : v;
    }
    const parsed = rowSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({ row: rowNo, column: issue.path.join(".") || undefined, message: issue.message });
      }
      return;
    }
    const r = parsed.data;
    const campaignName = r.campaign;
    const adSetName = r.ad_set || UNASSIGNED;
    const adName = r.ad || UNASSIGNED;
    const m = {
      row: rowNo,
      date: r.date,
      campaignExternalId: toExternalId(campaignName), campaignName,
      adSetExternalId: toExternalId(adSetName), adSetName,
      adExternalId: toExternalId(adName), adName,
      spend: r.spend, impressions: r.impressions, clicks: r.clicks,
      conversions: r.conversions, revenue: r.revenue,
    };
    // The same ad + the same day twice in the file: ambiguous, we do not guess (sum or overwrite?).
    const key = [m.campaignExternalId, m.adSetExternalId, m.adExternalId, m.date].join("|");
    const first = seen.get(key);
    if (first !== undefined) {
      errors.push({ row: rowNo, message: `Duplicate: same campaign/ad set/ad and date as row ${first}` });
      return;
    }
    seen.set(key, rowNo);
    metrics.push(m);
  });

  return { metrics, errors, totalRows, detected, signature, effectiveMapping };
}
