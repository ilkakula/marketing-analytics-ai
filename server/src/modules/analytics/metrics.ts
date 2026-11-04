// The only place where the formulas live. Pure functions, no database: easy to test and explain.
export interface Totals {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
}

export interface Metrics extends Totals {
  cpm: number | null;
  ctr: number | null;
  cpc: number | null;
  cvr: number | null;
  cpa: number | null;
  roas: number | null;
}

export type MetricKey = keyof Metrics;
export const METRIC_KEYS: MetricKey[] = [
  "spend", "impressions", "clicks", "conversions", "revenue", "cpm", "ctr", "cpc", "cvr", "cpa", "roas",
];

// Division by zero gives null (not Infinity/NaN): "no data" is not the same as "0".
const div = (a: number, b: number): number | null => (b === 0 ? null : a / b);

const round = (n: number | null, digits: number): number | null =>
  n === null ? null : Math.round(n * 10 ** digits) / 10 ** digits;

/**
 * Takes TOTALS, never averages. Overall CTR = total clicks / total impressions,
 * not the average of daily CTRs (which would treat a day with 10 impressions like a day with 100,000).
 */
export function computeMetrics(t: Totals): Metrics {
  return {
    spend: round(t.spend, 2)!,
    impressions: t.impressions,
    clicks: t.clicks,
    conversions: t.conversions,
    revenue: round(t.revenue, 2)!,
    cpm: round(div(t.spend, t.impressions) === null ? null : (t.spend / t.impressions) * 1000, 4),
    ctr: round(div(t.clicks, t.impressions) === null ? null : (t.clicks / t.impressions) * 100, 4),
    cpc: round(div(t.spend, t.clicks), 4),
    cvr: round(div(t.conversions, t.clicks) === null ? null : (t.conversions / t.clicks) * 100, 4),
    cpa: round(div(t.spend, t.conversions), 4),
    roas: round(div(t.revenue, t.spend), 4),
  };
}

/** Percentage change versus the previous period; null when it cannot be computed meaningfully. */
export function percentChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return round(((current - previous) / previous) * 100, 2);
}

export function changeMap(current: Metrics, previous: Metrics): Record<MetricKey, number | null> {
  return Object.fromEntries(
    METRIC_KEYS.map((k) => [k, percentChange(current[k], previous[k])]),
  ) as Record<MetricKey, number | null>;
}
