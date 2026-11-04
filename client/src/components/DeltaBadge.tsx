import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { POLARITY } from "@/lib/metricsMeta";
import type { MetricKey } from "@/lib/types";

// A change never carries meaning through color alone: always an arrow + sign + number.
export function DeltaBadge({ metric, change }: { metric: MetricKey; change: number | null | undefined }) {
  if (change === undefined) return null; // no comparison requested (e.g. campaign details)
  if (change === null) return <span className="text-xs text-muted">no comparison</span>;
  const dir = change > 0 ? "up" : change < 0 ? "down" : "flat";
  const polarity = POLARITY[metric];
  const tone = dir === "flat" || polarity === "neutral" ? "neutral" : dir === polarity ? "good" : "bad";
  const Icon = dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : Minus;
  const text = `${change > 0 ? "+" : ""}${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(change)}%`;
  const verdict = tone === "good" ? "better" : tone === "bad" ? "worse" : "no good or bad direction";
  const why = polarity === "down" ? "a lower value is better for this metric" : polarity === "up" ? "a higher value is better for this metric" : "";
  return (
    <Badge tone={tone} title={`${text} versus the previous period of the same length: ${verdict}${why ? ` (${why})` : ""}`}>
      <Icon className="size-3" aria-hidden /> {text}
      <span className="sr-only"> versus the previous period</span>
    </Badge>
  );
}
