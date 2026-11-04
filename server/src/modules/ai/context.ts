import type { Metrics, MetricKey } from "../analytics/metrics";
import type { Finding } from "./findings";

export interface AiContext {
  period: { from: string | null; to: string | null; days: number | null };
  currency: string;
  targetRoas?: number;
  totals: Metrics;
  previousTotals?: Metrics;
  changePercent?: Record<MetricKey, number | null>;
  topCampaigns: Array<Metrics & { name: string; spendSharePct: number }>;
  findings: Array<{ id: string; type: string; severity: string; campaign: string; date?: string; evidence: Record<string, number> }>;
}

export function buildContext(args: {
  from?: string; to?: string; currency: string; totals: Metrics; previousTotals?: Metrics;
  change?: Record<MetricKey, number | null>;
  campaigns: Array<Metrics & { name: string }>; findings: Finding[]; targetRoas?: number;
}): AiContext {
  const days = args.from && args.to ? Math.round((Date.parse(args.to) - Date.parse(args.from)) / 86_400_000) + 1 : null;
  return {
    period: { from: args.from ?? null, to: args.to ?? null, days },
    currency: args.currency,
    ...(args.targetRoas && args.targetRoas > 1 ? { targetRoas: args.targetRoas } : {}),
    totals: args.totals,
    ...(args.previousTotals ? { previousTotals: args.previousTotals } : {}),
    ...(args.change ? { changePercent: args.change } : {}),
    // Only per-campaign aggregates (top 15), never raw daily rows or ad-level data.
    topCampaigns: args.campaigns.slice(0, 15).map((c) => ({
      ...c, spendSharePct: args.totals.spend > 0 ? Math.round((c.spend / args.totals.spend) * 10_000) / 100 : 0,
    })),
    findings: args.findings.map((f) => ({ id: f.id, type: f.type, severity: f.severity, campaign: f.campaignName, ...(f.date ? { date: f.date } : {}), evidence: f.evidence })),
  };
}

/** All numbers the model may cite (collected from the context). */
export function numberPool(ctx: AiContext): number[] {
  const out: number[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(ctx);
  return out;
}
