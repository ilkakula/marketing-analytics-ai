import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, ChevronsUpDown, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useFmt } from "@/hooks/queries";
import { METRIC_LABEL } from "@/lib/metricsMeta";
import type { BreakdownRow, CampaignRow, MetricKey } from "@/lib/types";
import { cn } from "@/lib/cn";

export const TABLE_METRICS: MetricKey[] = ["spend", "impressions", "clicks", "ctr", "cpc", "conversions", "cpa", "revenue", "roas"];
// Secondary columns appear only on wide screens (2xl). On a laptop the key columns (spend, conversions,
// revenue, ROAS) fit without horizontal scrolling, so the most important metric is never off screen.
const SECONDARY = new Set<MetricKey>(["impressions", "clicks", "ctr", "cpc", "cpa"]);
const wide = (k: MetricKey) => (SECONDARY.has(k) ? "hidden 2xl:table-cell" : "");

interface Props {
  rows: Array<CampaignRow | BreakdownRow>;
  nameHeader: string;
  linkBase?: string; // if set, the name links to the details page
  sort?: { by: string; order: "asc" | "desc"; onChange: (by: string) => void };
  selection?: { ids: Set<string>; max: number; onToggle: (id: string) => void };
}

export function MetricsTable({ rows, nameHeader, linkBase, sort, selection }: Props) {
  const fmt = useFmt();
  const maxRoas = Math.max(1, ...rows.map((r) => r.roas ?? 0));

  const Th = ({ id, label, right, extra }: { id: string; label: string; right?: boolean; extra?: string }) => {
    const active = sort?.by === id;
    return (
      <th scope="col" aria-sort={active ? (sort!.order === "asc" ? "ascending" : "descending") : undefined}
        className={cn("whitespace-nowrap px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide", right && "text-right", extra)}>
        {sort ? (
          <button type="button" onClick={() => sort.onChange(id)}
            className={cn("inline-flex cursor-pointer items-center gap-1 transition-colors hover:text-ink", active && "text-ink")}>
            {label}
            {active ? (sort.order === "asc" ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />) : <ChevronsUpDown className="size-3 opacity-40" aria-hidden />}
          </button>
        ) : label}
      </th>
    );
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-line text-left text-ink-2">
          <tr>
            {selection && <th scope="col" className="w-8 px-3 py-2.5"><span className="sr-only">Select for comparison</span></th>}
            <Th id="name" label={nameHeader} />
            {TABLE_METRICS.map((k) => <Th key={k} id={k} label={METRIC_LABEL[k]} right extra={wide(k)} />)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="h-12 border-b border-line transition-colors last:border-0 hover:bg-surface-2">
              {selection && (
                <td className="px-3 py-2 align-middle">
                  <input type="checkbox" className="block size-4 cursor-pointer accent-[var(--accent)]" aria-label={`Select ${r.name} for comparison`}
                    checked={selection.ids.has(r.id)}
                    disabled={!selection.ids.has(r.id) && selection.ids.size >= selection.max}
                    onChange={() => selection.onToggle(r.id)} />
                </td>
              )}
              <td className="max-w-64 truncate px-3 py-3 font-medium">
                {linkBase ? <Link to={`${linkBase}/${r.id}`} className="text-ink transition-colors hover:text-accent-text hover:underline">{r.name}</Link> : r.name}
              </td>
              {TABLE_METRICS.map((k) => (
                <td key={k} className={cn("px-3 py-3 text-right tabular-nums text-ink-2", wide(k))}>
                  {k === "roas" ? (
                    <div className="flex items-center justify-end gap-2.5">
                      {r.roas !== null && r.roas < 1 && <Badge tone="bad"><TriangleAlert className="size-3" aria-hidden />Losing</Badge>}
                      {/* One-series data bar: length = ROAS relative to the best row; one hue, no extra legend. */}
                      <span className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-surface-3 md:block" aria-hidden>
                        <span className="block h-full rounded-full bg-series-1" style={{ width: `${Math.min(100, ((r.roas ?? 0) / maxRoas) * 100)}%` }} />
                      </span>
                      <span className="min-w-12 font-semibold text-ink">{fmt.metric(k, r[k])}</span>
                    </div>
                  ) : fmt.metric(k, r[k])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
