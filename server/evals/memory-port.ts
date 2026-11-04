import type { AnalyticsPort, CampaignRow, DailyRow } from "../src/modules/ai/ask/port";
import type { Filters } from "../src/modules/analytics/filters";
import { computeMetrics, type Metrics } from "../src/modules/analytics/metrics";
import { SCENARIOS, build, type Scenario } from "./scenarios";

// An in-memory AnalyticsPort built from a synthetic scenario: the evaluation runs the SAME tool code and
// the same model loop as production, without a database.

const agg = (rows: Metrics[]): Metrics => computeMetrics({
  spend: rows.reduce((a, r) => a + r.spend, 0), impressions: rows.reduce((a, r) => a + r.impressions, 0),
  clicks: rows.reduce((a, r) => a + r.clicks, 0), conversions: rows.reduce((a, r) => a + r.conversions, 0),
  revenue: rows.reduce((a, r) => a + r.revenue, 0),
});

const monday = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

function group<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return m;
}

export function memoryPort(scenario: Scenario): AnalyticsPort {
  const { input } = build(scenario);
  const daily: DailyRow[] = input.daily ?? [];
  const select = (f: Filters) => daily.filter((r) =>
    (!f.from || r.date >= f.from) && (!f.to || r.date <= f.to) && (!f.campaignIds?.length || f.campaignIds.includes(r.id)));

  return {
    async getTotals(f) { return agg(select(f)); },
    async getTimeseries(f) {
      return [...group(select(f), (r) => r.date)].sort(([a], [b]) => a.localeCompare(b)).map(([date, rows]) => ({ date, ...agg(rows) }));
    },
    async getWeekly(f) {
      return [...group(select(f), (r) => monday(r.date))].sort(([a], [b]) => a.localeCompare(b))
        .map(([week, rows]) => ({ week, days: new Set(rows.map((r) => r.date)).size, ...agg(rows) }));
    },
    async listCampaigns(f, o) {
      let items: CampaignRow[] = [...group(select(f), (r) => r.id)].map(([id, rows]) => ({ id, name: rows[0]!.name, ...agg(rows) }));
      if (o.search) items = items.filter((c) => c.name.toLowerCase().includes(o.search!.toLowerCase()));
      const val = (c: CampaignRow) => (o.sortBy === "name" ? c.name : c[o.sortBy]);
      items.sort((a, b) => {
        const x = val(a), y = val(b);
        if (x === null && y === null) return 0;
        if (x === null) return 1; // null (undefined ratio) always last
        if (y === null) return -1;
        const c = typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number);
        return o.order === "asc" ? c : -c;
      });
      return { items: items.slice((o.page - 1) * o.pageSize, o.page * o.pageSize), total: items.length };
    },
    async getCampaignWeekly(f) {
      const out = [];
      for (const [, rows] of group(select(f), (r) => `${r.id}|${monday(r.date)}`)) {
        out.push({ id: rows[0]!.id, name: rows[0]!.name, week: monday(rows[0]!.date), days: new Set(rows.map((r) => r.date)).size, ...agg(rows) });
      }
      return out.sort((a, b) => a.id.localeCompare(b.id) || a.week.localeCompare(b.week));
    },
    async getCampaignDaily(f) { return select(f); },
    async breakdown() { return []; }, // synthetic scenarios have no ad-level data
    async findCampaigns(_ws, name) {
      return [...new Map(daily.map((r) => [r.id, r.name])).entries()]
        .filter(([, n]) => n.toLowerCase().includes(name.toLowerCase())).map(([id, n]) => ({ id, name: n })).slice(0, 6);
    },
    async dataRange() { const d = daily.map((r) => r.date).sort(); return { from: d[0] ?? null, to: d.at(-1) ?? null }; },
    async fingerprint() { return "memory"; },
  };
}

export const scenarioById = (id: string) => SCENARIOS.find((s) => s.id === id)!;
