import type { Metrics } from "../analytics/metrics";

// The rules DECIDE what counts as a problem. The LLM never discovers findings, it only words them.
// Every threshold is a constant in one place, so the rules can be explained and tested.
export const THRESHOLDS = {
  minSpendShare: 0.05,        // a campaign must take at least 5% of the budget for a finding to matter
  losingMoneyRoas: 1,         // ROAS < 1: returns less than it costs
  highCpcVsWorkspace: 1.3,    // CPC 30% above the workspace average
  cpcSpike: 1.3,              // CPC grew 30%+ versus the previous period
  roasDrop: 0.75,             // ROAS fell 25%+ versus the previous period
  conversionDeclineWeeks: 3,  // consecutive complete weeks of decline
  conversionDeclineMinDrop: 0.2,
  topPerformerRoasVsWorkspace: 1.5,
  anomalyBaselineDays: 14,    // baseline = the 14 days immediately BEFORE the "recent" days (not the whole history)
  anomalyRecentDays: 3,       // only the last 3 days count: that is what can still be acted on
  anomalyRobustZ: 3.5,        // standard threshold for the robust z-score (median/MAD)
  spendSpikeFactor: 1.5,      // spend at least 1.5x above the usual
  conversionDropFactor: 0.5,  // conversions at least 50% below the usual
  anomalyMinMedianConversions: 3, // at smaller counts a "drop" is just noise
  noConversionMinClicks: 30,  // zero conversions only means something after enough clicks
  lowCtrVsWorkspace: 0.5,     // CTR below half of the workspace average
  lowCtrMinImpressions: 10_000, // a CTR from a few impressions is noise
  maxFindings: 10,
} as const;

export type FindingType =
  | "LOSING_MONEY" | "HIGH_CPC" | "CPC_SPIKE" | "ROAS_DROP" | "CONVERSION_DECLINE" | "TOP_PERFORMER"
  | "SPEND_ANOMALY" | "CONVERSIONS_ANOMALY" | "NO_CONVERSIONS" | "LOW_CTR" | "BELOW_TARGET_ROAS";
export type Severity = "high" | "medium" | "info";

export interface Finding {
  id: string; // F1, F2... (stable within one response; recommendations refer to it)
  type: FindingType;
  severity: Severity;
  campaignId: string;
  campaignName: string;
  date?: string; // the day a finding refers to (anomalies)
  evidence: Record<string, number>; // ALL numbers the finding relies on
}

type Named = Metrics & { id: string; name: string };
export interface WeeklyRow extends Named { week: string; days: number }

export interface DailyRow extends Named { date: string }

/** Goals the user set for the workspace. A target ROAS of 1 (or none) means "break-even", the original behavior. */
export interface Targets { roas?: number }

export interface FindingsInput {
  totals: Metrics;
  previousTotals?: Metrics;
  campaigns: Named[];
  previous?: Map<string, Metrics>;
  weekly: WeeklyRow[];
  daily?: DailyRow[];
  targets?: Targets;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Robust z-score: median and MAD instead of mean and standard deviation, because a single extreme
 * (exactly what we are looking for) must not corrupt its own baseline. 1.4826 scales MAD to σ.
 */
export function robustZ(x: number, baseline: number[]): number {
  const med = median(baseline);
  const mad = median(baseline.map((b) => Math.abs(b - med)));
  if (mad === 0) return x === med ? 0 : x > med ? Infinity : -Infinity; // perfectly flat baseline
  return (x - med) / (1.4826 * mad);
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const WEEK_MS = 7 * 86_400_000;
const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, info: 2 };

export function computeFindings(input: FindingsInput): Finding[] {
  const { totals, campaigns, previous, weekly } = input;
  const targetRoas = input.targets?.roas ?? 1;
  if (totals.spend <= 0) return [];
  const raw: Omit<Finding, "id">[] = [];
  const spendOf = new Map(campaigns.map((c) => [c.id, c.spend]));

  for (const c of campaigns) {
    const share = c.spend / totals.spend;
    if (share < THRESHOLDS.minSpendShare) continue;
    const base = { campaignId: c.id, campaignName: c.name };
    const sharePct = r2(share * 100);

    // Spend without a single conversion is a more specific diagnosis than "ROAS below 1" (it would be reported
    // as a loss too), so it takes its place instead of being reported twice.
    const noConversions = c.conversions === 0 && c.clicks >= THRESHOLDS.noConversionMinClicks;
    if (noConversions) {
      raw.push({ ...base, type: "NO_CONVERSIONS", severity: "high",
        evidence: { spend: r2(c.spend), clicks: c.clicks, spendSharePct: sharePct } });
    } else if (c.roas !== null && c.roas < THRESHOLDS.losingMoneyRoas) {
      raw.push({ ...base, type: "LOSING_MONEY", severity: "high",
        evidence: { roas: r2(c.roas), spend: r2(c.spend), revenue: r2(c.revenue), spendSharePct: sharePct } });
    } else if (targetRoas > 1 && c.roas !== null && c.roas < targetRoas) {
      // Profitable, but under the goal the user set: a softer finding than losing money.
      raw.push({ ...base, type: "BELOW_TARGET_ROAS", severity: "medium",
        evidence: { roas: r2(c.roas), targetRoas: r2(targetRoas), percentBelowTarget: r2((1 - c.roas / targetRoas) * 100), spendSharePct: sharePct } });
    }
    if (c.ctr !== null && totals.ctr !== null && c.impressions >= THRESHOLDS.lowCtrMinImpressions && c.ctr < totals.ctr * THRESHOLDS.lowCtrVsWorkspace) {
      raw.push({ ...base, type: "LOW_CTR", severity: "medium",
        evidence: { ctr: r2(c.ctr), workspaceCtr: r2(totals.ctr), percentBelowWorkspace: r2((1 - c.ctr / totals.ctr) * 100), impressions: c.impressions } });
    }
    if (c.cpc !== null && totals.cpc !== null && c.cpc > totals.cpc * THRESHOLDS.highCpcVsWorkspace) {
      raw.push({ ...base, type: "HIGH_CPC", severity: "medium",
        evidence: { cpc: r2(c.cpc), workspaceCpc: r2(totals.cpc), percentAboveWorkspace: r2((c.cpc / totals.cpc - 1) * 100), spendSharePct: sharePct } });
    }

    const p = previous?.get(c.id);
    if (p) {
      if (c.cpc !== null && p.cpc !== null && p.cpc > 0 && c.cpc >= p.cpc * THRESHOLDS.cpcSpike) {
        raw.push({ ...base, type: "CPC_SPIKE", severity: "medium",
          evidence: { cpc: r2(c.cpc), previousCpc: r2(p.cpc), percentChange: r2((c.cpc / p.cpc - 1) * 100) } });
      }
      if (c.roas !== null && p.roas !== null && p.roas > 0 && c.roas <= p.roas * THRESHOLDS.roasDrop) {
        raw.push({ ...base, type: "ROAS_DROP", severity: "high",
          evidence: { roas: r2(c.roas), previousRoas: r2(p.roas), percentChange: r2((c.roas / p.roas - 1) * 100) } });
      }
    }
  }

  // Conversion decline: the last 3 COMPLETE weeks (partial weeks at the edges distort the trend).
  const byCampaign = new Map<string, WeeklyRow[]>();
  for (const w of weekly) if (w.days === 7) byCampaign.set(w.id, [...(byCampaign.get(w.id) ?? []), w]);
  for (const [id, rows] of byCampaign) {
    const n = THRESHOLDS.conversionDeclineWeeks;
    const last = rows.sort((a, b) => a.week.localeCompare(b.week)).slice(-n);
    if (last.length < n || (spendOf.get(id) ?? 0) / totals.spend < THRESHOLDS.minSpendShare) continue;
    const consecutive = last.every((w, i) => i === 0 || Date.parse(w.week) - Date.parse(last[i - 1]!.week) === WEEK_MS);
    const falling = last.every((w, i) => i === 0 || w.conversions < last[i - 1]!.conversions);
    const first = last[0]!, end = last[n - 1]!;
    if (consecutive && falling && first.conversions > 0 &&
        (first.conversions - end.conversions) / first.conversions >= THRESHOLDS.conversionDeclineMinDrop) {
      raw.push({ campaignId: id, campaignName: first.name, type: "CONVERSION_DECLINE", severity: "high",
        evidence: { weeks: n, firstWeekConversions: first.conversions, lastWeekConversions: end.conversions,
          percentDrop: r2(((first.conversions - end.conversions) / first.conversions) * 100) } });
    }
  }

  // Anomalies in recent days versus that campaign's usual behavior.
  const byCampaignDaily = new Map<string, DailyRow[]>();
  for (const d of input.daily ?? []) byCampaignDaily.set(d.id, [...(byCampaignDaily.get(d.id) ?? []), d]);
  for (const [id, all] of byCampaignDaily) {
    if ((spendOf.get(id) ?? 0) / totals.spend < THRESHOLDS.minSpendShare) continue;
    const rows = all.sort((a, b) => a.date.localeCompare(b.date));
    // The baseline is a rolling window right before the recent days, not the whole history: against
    // a long history the tail of a steady decline looks like a sudden anomaly (and would be reported
    // twice, once as CONVERSION_DECLINE). A rolling window adapts to trends and still catches sudden breaks.
    const recentDays = THRESHOLDS.anomalyRecentDays;
    if (rows.length < recentDays + THRESHOLDS.anomalyBaselineDays) continue;
    const baseline = rows.slice(-recentDays - THRESHOLDS.anomalyBaselineDays, -recentDays);
    const recent = rows.slice(-recentDays);

    const spends = baseline.map((r) => r.spend);
    const spendMed = median(spends);
    const spike = recent
      .map((r) => ({ r, z: robustZ(r.spend, spends) }))
      .filter(({ r, z }) => z >= THRESHOLDS.anomalyRobustZ && spendMed > 0 && r.spend >= spendMed * THRESHOLDS.spendSpikeFactor)
      .sort((a, b) => b.z - a.z)[0];
    if (spike) {
      raw.push({ campaignId: id, campaignName: spike.r.name, type: "SPEND_ANOMALY", severity: "high", date: spike.r.date,
        evidence: { spend: r2(spike.r.spend), baselineSpend: r2(spendMed), percentAboveBaseline: r2((spike.r.spend / spendMed - 1) * 100) } });
    }

    const convs = baseline.map((r) => r.conversions);
    const convMed = median(convs);
    const drop = recent
      .map((r) => ({ r, z: robustZ(r.conversions, convs) }))
      .filter(({ r, z }) => z <= -THRESHOLDS.anomalyRobustZ && convMed >= THRESHOLDS.anomalyMinMedianConversions
        && r.conversions <= convMed * THRESHOLDS.conversionDropFactor && r.spend > 0)
      .sort((a, b) => a.z - b.z)[0];
    if (drop) {
      raw.push({ campaignId: id, campaignName: drop.r.name, type: "CONVERSIONS_ANOMALY", severity: "high", date: drop.r.date,
        evidence: { conversions: drop.r.conversions, baselineConversions: r2(convMed), percentBelowBaseline: r2((1 - drop.r.conversions / convMed) * 100), spend: r2(drop.r.spend) } });
    }
  }

  // Top performer (one): meaningful spend + ROAS at least 1.5x above the average.
  if (totals.roas !== null) {
    const best = campaigns
      .filter((c) => c.roas !== null && c.spend / totals.spend >= THRESHOLDS.minSpendShare && c.roas >= totals.roas! * THRESHOLDS.topPerformerRoasVsWorkspace)
      .sort((a, b) => b.roas! - a.roas!)[0];
    if (best) {
      raw.push({ campaignId: best.id, campaignName: best.name, type: "TOP_PERFORMER", severity: "info",
        evidence: { roas: r2(best.roas!), workspaceRoas: r2(totals.roas), roasVsWorkspace: r2(best.roas! / totals.roas), spendSharePct: r2((best.spend / totals.spend) * 100) } });
    }
  }

  return raw
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (spendOf.get(b.campaignId) ?? 0) - (spendOf.get(a.campaignId) ?? 0))
    .slice(0, THRESHOLDS.maxFindings)
    .map((f, i) => ({ ...f, id: `F${i + 1}` }));
}
