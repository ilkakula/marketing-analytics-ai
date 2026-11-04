import { BadgeDollarSign, Eye, MousePointerClick, Percent, Receipt, Target, TrendingUp, Wallet, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DeltaBadge } from "./DeltaBadge";
import { Sparkline } from "./Sparkline";
import { METRIC_LABEL } from "@/lib/metricsMeta";
import { useFmt } from "@/hooks/queries";
import type { Metrics, MetricKey, Point } from "@/lib/types";

export const KPI_KEYS: MetricKey[] = ["spend", "revenue", "roas", "conversions", "cpa", "ctr", "cpc", "clicks"];
const ICONS: Partial<Record<MetricKey, LucideIcon>> = {
  spend: Wallet, revenue: BadgeDollarSign, roas: TrendingUp, conversions: Target, cpa: Receipt, ctr: Percent, cpc: MousePointerClick, clicks: Eye,
};

export function KpiGrid({
  totals, change, points,
}: { totals: Metrics; change?: Record<MetricKey, number | null>; points: Point[] }) {
  const fmt = useFmt();
  return (
    <>
    <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
      {KPI_KEYS.map((k) => {
        const Icon = ICONS[k] ?? Eye;
        return (
          <div key={k} className="group relative overflow-hidden rounded-2xl border border-line bg-surface p-4 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-pop">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-medium text-ink-2">
                <span className="grid size-6 place-items-center rounded-md bg-accent-soft text-accent-text"><Icon className="size-3.5" aria-hidden /></span>
                {METRIC_LABEL[k]}
              </div>
              {k === "roas" && totals.roas !== null && (
                totals.roas >= 1 ? <Badge tone="good">Profitable</Badge> : <Badge tone="bad">Below break-even</Badge>
              )}
            </div>
            <div className="mt-3 text-[28px] font-semibold leading-none tracking-tight">{fmt.metric(k, totals[k])}</div>
            <div className="mt-2 h-5"><DeltaBadge metric={k} change={change?.[k]} /></div>
            <div className="-mx-1 mt-1"><Sparkline points={points} metric={k} /></div>
          </div>
        );
      })}
    </div>
    {change && (
      <p className="text-xs text-muted">
        Arrows compare with the previous period of the same length. Green is better, red is worse: more revenue is green,
        but a higher CPC or CPA is red. Spend has no good or bad direction.
      </p>
    )}
    </>
  );
}

export function KpiSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy>
      {KPI_KEYS.map((k) => (
        <div key={k} className="rounded-2xl border border-line bg-surface p-4">
          <Skeleton className="h-4 w-20" /><Skeleton className="mt-4 h-8 w-32" /><Skeleton className="mt-3 h-5 w-16" /><Skeleton className="mt-3 h-10 w-full" />
        </div>
      ))}
    </div>
  );
}
