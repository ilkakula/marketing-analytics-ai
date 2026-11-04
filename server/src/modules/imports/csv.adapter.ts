import { parse } from "csv-parse/sync";
import { z } from "zod";
import type { ImportRowError } from "../../database/models";
import { badRequest } from "../../shared/errors";
import { type AdMetric, UNASSIGNED, toExternalId } from "./adMetric";

export const MAX_ROWS = 50_000;

export const REQUIRED_FIELDS = ["date", "campaign", "spend", "impressions", "clicks", "conversions", "revenue"] as const;
export const OPTIONAL_FIELDS = ["ad_set", "ad"] as const;
const ALL_FIELDS = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];
type Field = (typeof ALL_FIELDS)[number];

/** Mapping: our field -> column name in the user's file. */
export type ColumnMapping = Partial<Record<Field, string>>;
export const mappingSchema = z.partialRecord(z.enum(ALL_FIELDS), z.string().min(1));

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, "_");

// Excel in European locales exports ";" as the separator.
function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  return (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
}

const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format").refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, "Date does not exist");

const text = (max = 255) => z.string().trim().min(1, "Required field").max(max);
const decimal = z.string().regex(/^\d+(\.\d+)?$/, "Must be a non-negative number").transform(Number);
const integer = z.string().regex(/^\d+$/, "Must be a non-negative integer").transform(Number);

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
}

export function parseCsv(buffer: Buffer, mapping: ColumnMapping = {}): ParsedCsv {
  const content = buffer.toString("utf8");
  if (!content.trim()) throw badRequest("The file is empty");
  const delimiter = detectDelimiter(content);

  let records: string[][];
  try {
    records = parse(content, {
      delimiter, bom: true, skip_empty_lines: true, relax_column_count: true, trim: true,
    });
  } catch (e) {
    throw badRequest(`The CSV could not be read: ${(e as Error).message}`);
  }

  const [header = [], ...rows] = records;
  if (rows.length === 0) throw badRequest("The file has no data rows");
  if (rows.length > MAX_ROWS) throw badRequest(`The file has too many rows (max ${MAX_ROWS})`);

  // Field -> column index. Explicit mapping first, then the same name (normalized).
  const headerIdx = new Map(header.map((h, i) => [norm(h), i]));
  const colIndex = new Map<Field, number>();
  for (const f of ALL_FIELDS) {
    const wanted = norm(mapping[f] ?? f);
    const idx = headerIdx.get(wanted);
    if (idx !== undefined) colIndex.set(f, idx);
  }
  const missing = REQUIRED_FIELDS.filter((f) => !colIndex.has(f));
  if (missing.length) {
    throw badRequest(`Missing required columns: ${missing.join(", ")}`, {
      missing, foundColumns: header, hint: "Use the 'mapping' field to map your column names.",
    });
  }

  const decimalComma = delimiter === ";"; // "12,50" -> "12.50"
  const errors: ImportRowError[] = [];
  const metrics: ParsedCsv["metrics"] = [];
  const seen = new Map<string, number>();

  rows.forEach((cells, i) => {
    const rowNo = i + 2; // red 1 je header
    const raw: Record<string, string> = {};
    for (const [f, idx] of colIndex) {
      let v = cells[idx] ?? "";
      if (decimalComma && (f === "spend" || f === "revenue")) v = v.replace(",", ".");
      raw[f] = v;
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

  return { metrics, errors, totalRows: rows.length };
}
