import { computeFindings, robustZ, type DailyRow, type FindingsInput, type WeeklyRow } from "../src/modules/ai/findings";
import { computeMetrics, type Metrics } from "../src/modules/analytics/metrics";

const m = (spend: number, impressions: number, clicks: number, conversions: number, revenue: number): Metrics =>
  computeMetrics({ spend, impressions, clicks, conversions, revenue });
const camp = (id: string, name: string, x: Metrics) => ({ id, name, ...x });

// Total: spend 1000. A = 500 (ROAS 4), B = 400 (ROAS 0.5, bad), C = 100 (10%)
const A = camp("a", "Alpha", m(500, 50000, 1000, 100, 2000));
const B = camp("b", "Beta", m(400, 40000, 400, 10, 200));
const C = camp("c", "Gamma", m(100, 10000, 100, 10, 300));
const totals = m(1000, 100000, 1500, 120, 2500);

const input = (over: Partial<FindingsInput> = {}): FindingsInput => ({ totals, campaigns: [A, B, C], weekly: [], ...over });
const types = (f: ReturnType<typeof computeFindings>) => f.map((x) => `${x.type}:${x.campaignName}`);

describe("computeFindings", () => {
  it("detects a campaign that loses money (ROAS < 1) with evidence", () => {
    const f = computeFindings(input());
    const lm = f.find((x) => x.type === "LOSING_MONEY")!;
    expect(lm).toMatchObject({ campaignName: "Beta", severity: "high", id: "F1" });
    expect(lm.evidence).toMatchObject({ roas: 0.5, spend: 400, revenue: 200, spendSharePct: 40 });
  });

  it("ignores small campaigns (below 5% of the budget)", () => {
    const tiny = camp("t", "Tiny", m(10, 1000, 5, 0, 0)); // ROAS 0, but only 1% of the budget
    const f = computeFindings(input({ campaigns: [A, B, C, tiny], totals: m(1010, 101000, 1505, 120, 2500) }));
    expect(types(f).some((t) => t.includes("Tiny"))).toBe(false);
  });

  it("high CPC compared with the workspace average", () => {
    // Beta CPC = 1.0, average = 0.6667 -> 50% above
    const f = computeFindings(input());
    expect(f.find((x) => x.type === "HIGH_CPC")!.evidence.percentAboveWorkspace).toBeCloseTo(50, 1); // CPC is rounded to 4 decimals
  });

  it("CPC spike and ROAS drop versus the previous period", () => {
    const previous = new Map<string, Metrics>([
      ["a", m(500, 50000, 1600, 100, 2000)],   // CPC 0.3125 -> now 0.5 (+60%)
      ["c", m(100, 10000, 100, 10, 800)],       // ROAS 8 -> now 3 (-62.5%)
    ]);
    const f = computeFindings(input({ previous }));
    expect(types(f)).toEqual(expect.arrayContaining(["CPC_SPIKE:Alpha", "ROAS_DROP:Gamma"]));
    expect(f.find((x) => x.type === "CPC_SPIKE")!.evidence.percentChange).toBe(60);
  });

  const week = (id: string, w: string, conv: number, days = 7): WeeklyRow => ({ id, name: "Alpha", week: w, days, ...m(100, 10000, 200, conv, 100) });

  it("conversion decline: 3 consecutive complete weeks falling by at least 20%", () => {
    const weekly = [week("a", "2026-10-05", 100), week("a", "2026-10-12", 80), week("a", "2026-10-19", 60)];
    const f = computeFindings(input({ weekly })).find((x) => x.type === "CONVERSION_DECLINE")!;
    expect(f.evidence).toEqual({ weeks: 3, firstWeekConversions: 100, lastWeekConversions: 60, percentDrop: 40 });
  });

  it("a conversion decline is not reported for a mild drop, growth, partial weeks or a broken sequence", () => {
    const run = (weekly: WeeklyRow[]) => computeFindings(input({ weekly })).some((x) => x.type === "CONVERSION_DECLINE");
    expect(run([week("a", "2026-10-05", 100), week("a", "2026-10-12", 95), week("a", "2026-10-19", 90)])).toBe(false); // -10%
    expect(run([week("a", "2026-10-05", 60), week("a", "2026-10-12", 80), week("a", "2026-10-19", 100)])).toBe(false);
    expect(run([week("a", "2026-10-05", 100), week("a", "2026-10-12", 80), week("a", "2026-10-19", 60, 3)])).toBe(false); // partial
    expect(run([week("a", "2026-10-05", 100), week("a", "2026-10-19", 80), week("a", "2026-10-26", 60)])).toBe(false); // gap
  });

  it("top performer only when at least 1.5x above the average", () => {
    const f = computeFindings(input()); // Alpha ROAS 4 vs average 2.5 -> 1.6x
    expect(f.find((x) => x.type === "TOP_PERFORMER")).toMatchObject({ campaignName: "Alpha", severity: "info" });
    const flat = computeFindings(input({ campaigns: [A, A], totals: A }));
    expect(flat.some((x) => x.type === "TOP_PERFORMER")).toBe(false);
  });

  it("sorts by severity, numbers the IDs and does not break on zero", () => {
    const f = computeFindings(input());
    expect(f.map((x) => x.severity)).toEqual([...f.map((x) => x.severity)].sort((a, b) => ["high", "medium", "info"].indexOf(a) - ["high", "medium", "info"].indexOf(b)));
    expect(f.map((x) => x.id)).toEqual(f.map((_, i) => `F${i + 1}`));
    expect(computeFindings({ totals: m(0, 0, 0, 0, 0), campaigns: [], weekly: [] })).toEqual([]);
  });
});

// ---------- Anomalies ----------

describe("robustZ", () => {
  it("a single extreme does not corrupt its own baseline (unlike a plain z-score)", () => {
    const base = [10, 11, 9, 10, 12, 10, 11, 9, 10, 10];
    expect(robustZ(10, base)).toBe(0);
    expect(robustZ(30, base)).toBeGreaterThan(10);
    expect(robustZ(-5, base)).toBeLessThan(-10);
  });
  it("flat baseline: any deviation is infinite, equality is 0", () => {
    expect(robustZ(5, [5, 5, 5, 5])).toBe(0);
    expect(robustZ(9, [5, 5, 5, 5])).toBe(Infinity);
    expect(robustZ(1, [5, 5, 5, 5])).toBe(-Infinity);
  });
});

describe("anomalies (last 3 days versus the baseline)", () => {
  const day = (i: number) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10);
  const noisy = (i: number) => 1 + ((i * 7) % 5) / 20; // 1.00–1.20, deterministic noise
  const series = (n: number, over: (i: number) => Partial<{ spend: number; conv: number }> = () => ({})): DailyRow[] =>
    Array.from({ length: n }, (_, i) => {
      const o = over(i);
      return { id: "a", name: "Alpha", date: day(i), ...m(o.spend ?? 100 * noisy(i), 10000, 200, o.conv ?? Math.round(20 * noisy(i)), 500) };
    });
  const run = (daily: DailyRow[]) => computeFindings({ totals: m(1000, 100000, 2000, 400, 2500), campaigns: [{ id: "a", name: "Alpha", ...m(500, 50000, 1000, 200, 1500) }], weekly: [], daily });

  it("spend spike within the last 3 days", () => {
    const f = run(series(30, (i) => (i === 28 ? { spend: 350 } : {}))).find((x) => x.type === "SPEND_ANOMALY")!;
    expect(f).toMatchObject({ severity: "high", date: day(28), campaignName: "Alpha" });
    expect(f.evidence.spend).toBe(350);
    expect(f.evidence.percentAboveBaseline).toBeGreaterThan(200);
  });

  it("conversion drop while spend continues", () => {
    const f = run(series(30, (i) => (i === 29 ? { conv: 1 } : {}))).find((x) => x.type === "CONVERSIONS_ANOMALY")!;
    expect(f).toMatchObject({ date: day(29) });
    expect(f.evidence.conversions).toBe(1);
    expect(f.evidence.baselineConversions).toBeGreaterThan(18);
  });

  it("does not report ordinary noise, gradual growth or old anomalies", () => {
    const has = (d: DailyRow[]) => run(d).some((x) => x.type.endsWith("_ANOMALY"));
    expect(has(series(30))).toBe(false);
    expect(has(series(30, (i) => ({ spend: 100 + i * 3 })))).toBe(false);            // a trend, not a spike
    expect(has(series(30, (i) => (i === 10 ? { spend: 500 } : {})))).toBe(false);    // long ago, not actionable
  });

  it("requires enough history and does not react to small numbers", () => {
    expect(run(series(10, (i) => (i === 9 ? { spend: 900 } : {}))).some((x) => x.type === "SPEND_ANOMALY")).toBe(false); // < 14 days of baseline
    const tiny = series(30, (i) => ({ conv: i % 2 })); // median 0.5: a drop to 0 is noise
    expect(run(tiny).some((x) => x.type === "CONVERSIONS_ANOMALY")).toBe(false);
  });

  it("does not report a conversion drop when the campaign is not even spending", () => {
    const d = series(30, (i) => (i === 29 ? { conv: 0, spend: 0 } : {}));
    expect(run(d).some((x) => x.type === "CONVERSIONS_ANOMALY")).toBe(false);
  });
});
