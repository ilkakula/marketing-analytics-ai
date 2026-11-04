import { useEffect, useId, useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { useFmt } from "@/hooks/queries";
import { cn } from "@/lib/cn";
import { compact, longDate, shortDate } from "@/lib/format";
import { METRIC_LABEL } from "@/lib/metricsMeta";
import type { MetricKey, Point } from "@/lib/types";

// Fewer x-axis labels on narrow screens, so dates never overlap.
function useNarrow() {
  const [narrow, setNarrow] = useState(() => matchMedia("(max-width: 640px)").matches);
  useEffect(() => {
    const mq = matchMedia("(max-width: 640px)");
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

type Mode = "spend_revenue" | MetricKey;
const MODES: Mode[] = ["spend_revenue", "roas", "conversions", "clicks", "impressions", "ctr", "cpc", "cpa"];
const modeLabel = (m: Mode) => (m === "spend_revenue" ? "Spend and revenue" : METRIC_LABEL[m]);

// Two measures in the SAME currency share one axis (no dual axis); different units get a separate view.
const seriesFor = (m: Mode): { key: MetricKey; color: string }[] =>
  m === "spend_revenue"
    ? [{ key: "spend", color: "var(--series-1)" }, { key: "revenue", color: "var(--series-2)" }]
    : [{ key: m, color: "var(--series-1)" }];

/** Days without data become gaps (the line breaks) instead of lying through interpolation. */
function fillGaps(points: Point[]): Array<Partial<Point> & { date: string }> {
  if (points.length === 0) return [];
  const byDate = new Map(points.map((p) => [p.date, p]));
  const out: Array<Partial<Point> & { date: string }> = [];
  const end = new Date(`${points[points.length - 1]!.date}T00:00:00Z`);
  for (let d = new Date(`${points[0]!.date}T00:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    out.push(byDate.get(iso) ?? { date: iso });
  }
  return out;
}

export function TimeseriesChart({ points }: { points: Point[] }) {
  const uid = useId().replace(/:/g, "");
  const [mode, setMode] = useState<Mode>("spend_revenue");
  const [asTable, setAsTable] = useState(false);
  const [hidden, setHidden] = useState<Set<MetricKey>>(new Set());
  const fmt = useFmt();
  const narrow = useNarrow();
  const data = useMemo(() => fillGaps(points), [points]);
  const all = seriesFor(mode);
  const series = all.filter((s) => !hidden.has(s.key));
  const lastIdx = data.length - 1;

  const toggle = (k: MetricKey) => setHidden((h) => {
    const n = new Set(h);
    if (n.has(k)) n.delete(k); else if (n.size < all.length - 1) n.add(k); // always keep one series visible
    return n;
  });

  return (
    <Card className="animate-fade-up">
      <CardHeader className="flex-wrap">
        <div>
          <CardTitle>{modeLabel(mode)} per day</CardTitle>
          <p className="mt-0.5 text-xs text-ink-2">Daily totals for the selected period</p>
        </div>
        <div className="flex items-center gap-2">
          <Segmented<"chart" | "table"> label="View" value={asTable ? "table" : "chart"}
            options={[{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }]} onChange={(v) => setAsTable(v === "table")} />
          <Select className="w-full sm:w-44" aria-label="Metric" value={mode} onChange={(e) => { setMode(e.target.value as Mode); setHidden(new Set()); }}>
            {MODES.map((m) => <option key={m} value={m}>{modeLabel(m)}</option>)}
          </Select>
        </div>
      </CardHeader>
      <CardBody>
        {all.length > 1 && (
          <ul className="mb-3 flex gap-2 text-xs">
            {all.map((s) => {
              const off = hidden.has(s.key);
              return (
                <li key={s.key}>
                  <button type="button" aria-pressed={!off} onClick={() => toggle(s.key)}
                    className={cn("flex cursor-pointer items-center gap-2 rounded-full border border-line px-2.5 py-1 transition-all", off ? "text-muted line-through opacity-60" : "text-ink hover:bg-surface-3")}>
                    <span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color }} aria-hidden />
                    {METRIC_LABEL[s.key]}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {asTable ? (
          <div className="max-h-80 overflow-auto rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-2 text-left text-xs text-ink-2">
                <tr><th className="px-3 py-2 font-medium">Date</th>{all.map((s) => <th key={s.key} className="px-3 py-2 text-right font-medium">{METRIC_LABEL[s.key]}</th>)}</tr>
              </thead>
              <tbody>
                {points.map((p) => (
                  <tr key={p.date} className="border-t border-line">
                    <td className="px-3 py-2">{longDate(p.date)}</td>
                    {all.map((s) => <td key={s.key} className="px-3 py-2 text-right tabular-nums">{fmt.metric(s.key, p[s.key])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="h-80" role="img" aria-label={`Chart: ${modeLabel(mode)} per day`}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 8, right: all.length > 1 ? 72 : 12, bottom: 0, left: 0 }}>
                <defs>
                  {all.map((s) => (
                    <linearGradient key={s.key} id={`${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={s.color} stopOpacity={0.1} />
                      <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid vertical={false} stroke="var(--grid)" />
                <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fill: "var(--muted)", fontSize: 12 }}
                  axisLine={{ stroke: "var(--axis)" }} tickLine={false} interval={Math.max(0, Math.ceil(data.length / (narrow ? 4 : 8)) - 1)} />
                <YAxis tickFormatter={(v: number) => compact(v)} tick={{ fill: "var(--muted)", fontSize: 12 }}
                  axisLine={false} tickLine={false} width={48} />
                <Tooltip
                  cursor={{ stroke: "var(--axis)", strokeWidth: 1 }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const seen = new Set<string>();
                    const rows = payload.filter((p) => p.stroke && p.stroke !== "none" && !seen.has(String(p.dataKey)) && seen.add(String(p.dataKey)));
                    return (
                      <div className="min-w-44 rounded-xl border border-line-strong bg-surface-2/95 px-3.5 py-2.5 text-xs shadow-pop backdrop-blur">
                        <div className="mb-1.5 font-medium text-ink">{longDate(String(label))}</div>
                        {rows.map((p) => (
                          <div key={String(p.dataKey)} className="flex items-center justify-between gap-6 py-0.5 text-ink-2">
                            <span className="flex items-center gap-1.5">
                              <span className="inline-block size-2 rounded-full" style={{ background: p.stroke }} aria-hidden />
                              {METRIC_LABEL[p.dataKey as MetricKey]}
                            </span>
                            <span className="font-semibold tabular-nums text-ink">{fmt.metric(p.dataKey as MetricKey, (p.value as number | null) ?? null)}</span>
                          </div>
                        ))}
                      </div>
                    );
                  }}
                />
                {series.map((s) => (
                  <Area key={`a-${s.key}`} dataKey={s.key} type="monotone" stroke="none" fill={`url(#${uid}-${s.key})`} isAnimationActive={false} activeDot={false} legendType="none" tooltipType="none" />
                ))}
                {series.map((s) => (
                  <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} dot={false}
                    activeDot={{ r: 4.5, stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false}
                    label={all.length > 1 ? ((props: { x?: number; y?: number; index?: number }) =>
                      props.index === lastIdx ? (
                        <text key={s.key} x={(props.x ?? 0) + 8} y={(props.y ?? 0) + 4} fontSize={12} fill="var(--ink-2)">
                          {METRIC_LABEL[s.key]}
                        </text>
                      ) : <g key={`${s.key}-${props.index}`} />) as never : false}
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
