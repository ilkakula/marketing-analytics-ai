import { changeMap, type Metrics, type MetricKey } from "../analytics/metrics";
import { previousPeriod, type Filters } from "../analytics/filters";
import type { AnalyticsPort, CampaignRow } from "./ask/port";
import { computeFindings, type Finding } from "./findings";

const MAX_CAMPAIGNS = 100;

export interface Analysis {
  totals: Metrics;
  previousTotals?: Metrics;
  change?: Record<MetricKey, number | null>;
  campaigns: CampaignRow[];
  findings: Finding[];
}

/** One place that turns raw numbers into findings: used by both the insights panel and "ask your data". */
export async function analyzePeriod(port: AnalyticsPort, filters: Filters): Promise<Analysis> {
  const { from, to } = filters;
  const list = (f: Filters) => port.listCampaigns(f, { sortBy: "spend", order: "desc", page: 1, pageSize: MAX_CAMPAIGNS });
  const prevFilters = from && to ? { ...filters, ...previousPeriod(from, to) } : undefined;

  const [totals, campaigns, weekly, daily, previousTotals, previousList] = await Promise.all([
    port.getTotals(filters), list(filters), port.getCampaignWeekly(filters), port.getCampaignDaily(filters),
    prevFilters ? port.getTotals(prevFilters) : undefined,
    prevFilters ? list(prevFilters) : undefined,
  ]);

  const findings = computeFindings({
    totals, previousTotals, campaigns: campaigns.items, weekly, daily,
    previous: previousList ? new Map(previousList.items.map((c) => [c.id, c as Metrics])) : undefined,
  });
  return {
    totals, previousTotals, campaigns: campaigns.items, findings,
    change: previousTotals ? changeMap(totals, previousTotals) : undefined,
  };
}
