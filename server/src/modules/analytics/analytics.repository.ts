import { QueryTypes } from "sequelize";
import { sequelize } from "../../database/sequelize";
import type { Filters } from "./filters";
import { type Metrics, type Totals, computeMetrics } from "./metrics";

// All SQL lives here. Values go ONLY through :replacements (never concatenation),
// and sort column names come from a whitelist.
const BASE = `FROM daily_metrics dm
  JOIN ads a ON a.id = dm.ad_id
  JOIN ad_sets s ON s.id = a.ad_set_id`;

const SUMS = `
  COALESCE(SUM(dm.spend), 0)::float8 AS spend,
  COALESCE(SUM(dm.impressions), 0)::float8 AS impressions,
  COALESCE(SUM(dm.clicks), 0)::float8 AS clicks,
  COALESCE(SUM(dm.conversions), 0)::float8 AS conversions,
  COALESCE(SUM(dm.revenue), 0)::float8 AS revenue`;

function where(f: Filters) {
  const parts = ["dm.workspace_id = :workspaceId"];
  const replacements: Record<string, unknown> = { workspaceId: f.workspaceId };
  if (f.from) { parts.push("dm.date >= :from"); replacements.from = f.from; }
  if (f.to) { parts.push("dm.date <= :to"); replacements.to = f.to; }
  if (f.campaignIds?.length) { parts.push("s.campaign_id IN (:campaignIds)"); replacements.campaignIds = f.campaignIds; }
  return { sql: parts.join(" AND "), replacements };
}

const q = <T extends object>(sql: string, replacements: Record<string, unknown>) =>
  sequelize.query<T>(sql, { replacements, type: QueryTypes.SELECT });

export async function getTotals(f: Filters): Promise<Metrics> {
  const w = where(f);
  const [row] = await q<Totals>(`SELECT ${SUMS} ${BASE} WHERE ${w.sql}`, w.replacements);
  return computeMetrics(row!);
}

export async function getTimeseries(f: Filters) {
  const w = where(f);
  const rows = await q<Totals & { date: string }>(
    `SELECT to_char(dm.date, 'YYYY-MM-DD') AS date, ${SUMS} ${BASE} WHERE ${w.sql} GROUP BY dm.date ORDER BY dm.date`,
    w.replacements);
  return rows.map(({ date, ...t }) => ({ date, ...computeMetrics(t) }));
}

// ---- Campaigns ----
// Sorting by computed metrics happens in SQL (NULLIF = the same "null on division by zero" rule).
const SORT_SQL = {
  name: "c.name",
  spend: "SUM(dm.spend)",
  impressions: "SUM(dm.impressions)",
  clicks: "SUM(dm.clicks)",
  conversions: "SUM(dm.conversions)",
  revenue: "SUM(dm.revenue)",
  cpm: "SUM(dm.spend) / NULLIF(SUM(dm.impressions), 0) * 1000",
  ctr: "SUM(dm.clicks)::numeric / NULLIF(SUM(dm.impressions), 0)",
  cpc: "SUM(dm.spend) / NULLIF(SUM(dm.clicks), 0)",
  cvr: "SUM(dm.conversions)::numeric / NULLIF(SUM(dm.clicks), 0)",
  cpa: "SUM(dm.spend) / NULLIF(SUM(dm.conversions), 0)",
  roas: "SUM(dm.revenue) / NULLIF(SUM(dm.spend), 0)",
} as const;
export type CampaignSort = keyof typeof SORT_SQL;
export const CAMPAIGN_SORT_KEYS = Object.keys(SORT_SQL) as [CampaignSort, ...CampaignSort[]];

const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

export async function listCampaigns(
  f: Filters,
  o: { search?: string; sortBy: CampaignSort; order: "asc" | "desc"; page: number; pageSize: number },
) {
  const w = where(f);
  let sql = w.sql;
  const rep: Record<string, unknown> = { ...w.replacements, limit: o.pageSize, offset: (o.page - 1) * o.pageSize };
  if (o.search) { sql += " AND c.name ILIKE :search"; rep.search = `%${escapeLike(o.search)}%`; }
  const from = `${BASE} JOIN campaigns c ON c.id = s.campaign_id`;
  const dir = o.order === "asc" ? "ASC" : "DESC";

  const rows = await q<Totals & { id: string; name: string }>(
    `SELECT c.id, c.name, ${SUMS} ${from} WHERE ${sql} GROUP BY c.id, c.name
     ORDER BY ${SORT_SQL[o.sortBy]} ${dir} NULLS LAST, c.name ASC LIMIT :limit OFFSET :offset`, rep);
  const [{ total } = { total: 0 }] = await q<{ total: number }>(
    `SELECT COUNT(DISTINCT c.id)::int AS total ${from} WHERE ${sql}`, rep);

  return {
    items: rows.map(({ id, name, ...t }) => ({ id, name, ...computeMetrics(t) })),
    total,
  };
}

export async function breakdown(f: Filters, level: "ad_set" | "ad") {
  const w = where(f);
  const [cols, group] = level === "ad_set"
    ? ["s.id, s.name", "s.id, s.name"]
    : ["a.id, a.name, s.id AS ad_set_id", "a.id, a.name, s.id"];
  const rows = await q<Totals & { id: string; name: string; ad_set_id?: string }>(
    `SELECT ${cols}, ${SUMS} ${BASE} WHERE ${w.sql} GROUP BY ${group} ORDER BY SUM(dm.spend) DESC, 2`, w.replacements);
  return rows.map(({ id, name, ad_set_id, ...t }) => ({
    id, name, ...(ad_set_id ? { adSetId: ad_set_id } : {}), ...computeMetrics(t),
  }));
}

/** Weekly totals per campaign (for trend detection). `days` = number of days with data in that week. */
export async function getCampaignWeekly(f: Filters) {
  const w = where(f);
  const rows = await q<Totals & { id: string; name: string; week: string; days: number }>(
    `SELECT c.id, c.name, to_char(date_trunc('week', dm.date), 'YYYY-MM-DD') AS week,
            COUNT(DISTINCT dm.date)::int AS days, ${SUMS}
     ${BASE} JOIN campaigns c ON c.id = s.campaign_id
     WHERE ${w.sql} GROUP BY c.id, c.name, date_trunc('week', dm.date) ORDER BY c.id, week`, w.replacements);
  return rows.map(({ id, name, week, days, ...t }) => ({ id, name, week, days, ...computeMetrics(t) }));
}

/** Daily totals per campaign (for anomaly detection). */
export async function getCampaignDaily(f: Filters) {
  const w = where(f);
  const rows = await q<Totals & { id: string; name: string; date: string }>(
    `SELECT c.id, c.name, to_char(dm.date, 'YYYY-MM-DD') AS date, ${SUMS}
     ${BASE} JOIN campaigns c ON c.id = s.campaign_id
     WHERE ${w.sql} GROUP BY c.id, c.name, dm.date ORDER BY c.id, dm.date`, w.replacements);
  return rows.map(({ id, name, date, ...t }) => ({ id, name, date, ...computeMetrics(t) }));
}

/** Overall weekly totals (Monday-aligned). `days` = number of days with data in that week. */
export async function getWeekly(f: Filters) {
  const w = where(f);
  const rows = await q<Totals & { week: string; days: number }>(
    `SELECT to_char(date_trunc('week', dm.date), 'YYYY-MM-DD') AS week, COUNT(DISTINCT dm.date)::int AS days, ${SUMS}
     ${BASE} WHERE ${w.sql} GROUP BY date_trunc('week', dm.date) ORDER BY week`, w.replacements);
  return rows.map(({ week, days, ...t }) => ({ week, days, ...computeMetrics(t) }));
}

/** First and last day with data in a workspace. */
export async function getDataRange(workspaceId: string) {
  const [row] = await q<{ first: string | null; last: string | null }>(
    `SELECT to_char(MIN(date), 'YYYY-MM-DD') AS first, to_char(MAX(date), 'YYYY-MM-DD') AS last FROM daily_metrics WHERE workspace_id = :workspaceId`,
    { workspaceId });
  return { from: row?.first ?? null, to: row?.last ?? null };
}

/** Changes whenever data is imported or overwritten: used to invalidate cached answers. */
export async function getDataFingerprint(workspaceId: string) {
  const [row] = await q<{ n: number; last: string | null }>(
    `SELECT COUNT(*)::int AS n, MAX(updated_at)::text AS last FROM daily_metrics WHERE workspace_id = :workspaceId`, { workspaceId });
  return `${row?.n ?? 0}|${row?.last ?? ""}`;
}
