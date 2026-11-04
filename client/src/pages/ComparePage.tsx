import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import { ArrowLeft, Trophy } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { ErrorBox, Loading } from "@/components/ui/states";
import { useFmt } from "@/hooks/queries";
import { api } from "@/lib/api";
import { useRange } from "@/lib/dateRange";
import { compact, longDate, shortDate } from "@/lib/format";
import { METRIC_LABEL, POLARITY } from "@/lib/metricsMeta";
import type { CampaignDetail, MetricKey } from "@/lib/types";
import { PageHeader } from "./PageHeader";

// Fixed color order by selection (not by rank): validated with a script for 4 series in both modes.
const SERIES_COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABLE_ROWS: MetricKey[] = ["spend", "revenue", "roas", "conversions", "cpa", "cvr", "clicks", "cpc", "ctr", "impressions", "cpm"];
const CHART_METRICS: MetricKey[] = ["roas", "spend", "revenue", "conversions", "cpa", "cpc", "ctr", "clicks"];

// The chart geometry is fixed (height 320, top margin 8, X axis 30), so the Y positions of the
// line ends are computable without measuring the DOM and the labels can be spread out up front.
const H = 320, TOP = 8, AXIS = 30, PLOT = H - TOP - AXIS;
const niceCeil = (max: number) => {
  if (!(max > 0)) return 1;
  const exp = 10 ** Math.floor(Math.log10(max));
  const f = max / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
};

/** Spreads labels that would overlap: returns the offset (px) for each, keeping a minimum gap. */
export function spreadLabels(ys: number[], gap = 14): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const placed: number[] = [];
  const out = new Array<number>(ys.length).fill(0);
  order.forEach(({ y, i }, k) => {
    const pos = k === 0 ? y : Math.max(y, placed[k - 1]! + gap);
    placed.push(pos);
    out[i] = pos - y;
  });
  return out;
}

/** Best value in a row: higher for "growth is good", lower for cost metrics; neutral ones are not highlighted. */
function bestOf(metric: MetricKey, values: Array<number | null>): number | null {
  const pol = POLARITY[metric];
  const nums = values.filter((v): v is number => v !== null);
  if (pol === "neutral" || nums.length < 2) return null;
  return pol === "up" ? Math.max(...nums) : Math.min(...nums);
}

export function ComparePage() {
  const [params] = useSearchParams();
  const ids = useMemo(() => [...new Set((params.get("ids") ?? "").split(",").filter(Boolean))], [params]);
  const valid = ids.length >= 2 && ids.length <= 4 && ids.every((i) => UUID.test(i));
  const { range } = useRange();
  const fmt = useFmt();
  const [metric, setMetric] = useState<MetricKey>("roas");

  const results = useQueries({
    queries: (valid ? ids : []).map((id) => ({
      queryKey: ["campaign", id, range.from, range.to],
      queryFn: () => api<CampaignDetail>(`/api/campaigns/${id}`, { query: { from: range.from, to: range.to } }),
    })),
  });
  const data = results.map((r) => r.data);
  const error = results.find((r) => r.error)?.error;
  const ready = valid && data.every(Boolean);
  const camps = (ready ? data : []) as CampaignDetail[];

  // One row per date, one column per campaign (c0..c3); a missing day = a break in the line.
  const chart = useMemo(() => {
    const byDate = new Map<string, Record<string, number | null | string>>();
    camps.forEach((c, i) => c.timeseries.forEach((p) => {
      const row = byDate.get(p.date) ?? { date: p.date };
      row[`c${i}`] = p[metric];
      byDate.set(p.date, row);
    }));
    const rows = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    // The end value of each line (the last day that has data) and a fixed Y range [0, yMax].
    const ends = camps.map((_, i) => rows.reduce<number | null>((acc, r) => (typeof r[`c${i}`] === "number" ? (r[`c${i}`] as number) : acc), null));
    const yMax = niceCeil(Math.max(0, ...rows.flatMap((r) => camps.map((_, i) => (typeof r[`c${i}`] === "number" ? (r[`c${i}`] as number) : 0)))));
    const ys = ends.map((v) => (v === null ? null : TOP + (1 - v / yMax) * PLOT));
    const present = ys.flatMap((y, i) => (y === null ? [] : [i]));
    const spread = spreadLabels(present.map((i) => ys[i]!));
    const labels = present.map((i, k) => ({ i, y: ys[i]! + spread[k]! }));
    return { rows, yMax, labels };
  }, [camps, metric]);

  if (!valid) {
    return (
      <>
        <Link to="/campaigns" className="inline-flex items-center gap-1.5 text-sm text-ink-2 transition-colors hover:text-ink"><ArrowLeft className="size-4" aria-hidden /> Campaigns</Link>
        <Card><CardBody className="py-10 text-center text-sm text-ink-2">Select 2 to 4 campaigns on the Campaigns page.</CardBody></Card>
      </>
    );
  }

  return (
    <>
      <Link to="/campaigns" className="inline-flex items-center gap-1.5 text-sm text-ink-2 transition-colors hover:text-ink"><ArrowLeft className="size-4" aria-hidden /> Campaigns</Link>
      <PageHeader title="Campaign comparison" subtitle={ready ? camps.map((c) => c.name).join(" · ") : undefined} />
      {error != null && <ErrorBox error={error} />}
      {!ready ? (error ? null : <Loading />) : (
        <>
          <Card className="animate-fade-up">
            <CardBody className="overflow-x-auto px-2 pt-3">
              <table className="w-full text-sm">
                <thead className="border-b border-line text-left text-xs text-ink-2">
                  <tr>
                    <th scope="col" className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide">Metric</th>
                    {camps.map((c, i) => (
                      <th key={c.id} scope="col" className="px-3 py-2 text-right font-medium text-ink">
                        <span className="mr-1.5 inline-block h-0.5 w-4 rounded align-middle" style={{ background: SERIES_COLORS[i] }} aria-hidden />
                        <Link to={`/campaigns/${c.id}`} className="hover:underline">{c.name}</Link>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {TABLE_ROWS.map((k) => {
                    const values = camps.map((c) => c.totals[k]);
                    const best = bestOf(k, values);
                    return (
                      <tr key={k} className="border-b border-line last:border-0">
                        <th scope="row" className="px-3 py-2.5 text-left font-medium text-ink-2">{METRIC_LABEL[k]}</th>
                        {values.map((v, i) => (
                          <td key={camps[i]!.id} className={`px-3 py-2.5 text-right tabular-nums ${v !== null && v === best ? "font-semibold text-ink" : "text-ink-2"}`}>
                            {v !== null && v === best && <><Trophy className="mr-1 inline size-3.5 align-text-bottom" aria-hidden /><span className="sr-only">best: </span></>}
                            {fmt.metric(k, v)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="px-3 pb-1 pt-2 text-xs text-ink-2"><Trophy className="mr-1 inline size-3 align-text-bottom" aria-hidden />Best value in the row (spend and impressions are not rated).</p>
            </CardBody>
          </Card>

          <Card className="animate-fade-up">
            <CardHeader>
              <CardTitle>{METRIC_LABEL[metric]} per day</CardTitle>
              <Select className="w-44" aria-label="Metric" value={metric} onChange={(e) => setMetric(e.target.value as MetricKey)}>
                {CHART_METRICS.map((m) => <option key={m} value={m}>{METRIC_LABEL[m]}</option>)}
              </Select>
            </CardHeader>
            <CardBody>
              <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
                {camps.map((c, i) => (
                  <li key={c.id} className="flex items-center gap-1.5">
                    <span className="inline-block h-0.5 w-4 rounded" style={{ background: SERIES_COLORS[i] }} aria-hidden />{c.name}
                  </li>
                ))}
              </ul>
              <div className="relative" style={{ height: H }} role="img" aria-label={`Chart: ${METRIC_LABEL[metric]} per day for the selected campaigns`}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chart.rows} margin={{ top: TOP, right: 130, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--grid)" />
                    <XAxis dataKey="date" height={AXIS} tickFormatter={shortDate} tick={{ fill: "var(--muted)", fontSize: 12 }} axisLine={{ stroke: "var(--axis)" }} tickLine={false} minTickGap={32} />
                    <YAxis domain={[0, chart.yMax]} ticks={[0, 1, 2, 3, 4].map((k) => (chart.yMax * k) / 4)} tickFormatter={(v: number) => compact(v)} tick={{ fill: "var(--muted)", fontSize: 12 }} axisLine={false} tickLine={false} width={48} />
                    <Tooltip cursor={{ stroke: "var(--axis)", strokeWidth: 1 }} content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-md">
                          <div className="mb-1 font-medium text-ink">{longDate(String(label))}</div>
                          {payload.map((p) => (
                            <div key={String(p.dataKey)} className="flex items-center justify-between gap-4 text-ink-2">
                              <span className="flex items-center gap-1.5"><span className="inline-block size-2 rounded-full" style={{ background: p.color }} aria-hidden />{camps[Number(String(p.dataKey).slice(1))]?.name}</span>
                              <span className="font-medium tabular-nums text-ink">{fmt.metric(metric, (p.value as number | null) ?? null)}</span>
                            </div>
                          ))}
                        </div>
                      );
                    }} />
                    {camps.map((c, i) => (
                      <Line key={c.id} dataKey={`c${i}`} type="monotone" stroke={SERIES_COLORS[i]} strokeWidth={2} dot={false}
                        activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
                {/* Direct labels at the line ends (an HTML layer, spread so they do not overlap). */}
                <div className="pointer-events-none absolute right-0 top-0 w-[122px]" aria-hidden>
                  {chart.labels.map(({ i, y }) => (
                    <span key={camps[i]!.id} className="absolute left-0 truncate text-xs text-ink-2" style={{ top: y - 8, maxWidth: 122 }}>
                      {camps[i]!.name}
                    </span>
                  ))}
                </div>
              </div>
            </CardBody>
          </Card>
        </>
      )}
    </>
  );
}
