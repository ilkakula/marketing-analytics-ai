import { changeMap, computeMetrics, percentChange } from "../src/modules/analytics/metrics";

const zero = { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 };

describe("computeMetrics", () => {
  it("computes every formula from the specification", () => {
    // 2 rows from the example: 100+80 spend, 10000+8000 impr, 250+120 clicks, 20+8 conv, 500+160 rev
    const m = computeMetrics({ spend: 180, impressions: 18000, clicks: 370, conversions: 28, revenue: 660 });
    expect(m.cpm).toBe(10);                // 180 / 18000 * 1000
    expect(m.ctr).toBe(2.0556);            // 370 / 18000 * 100
    expect(m.cpc).toBe(0.4865);            // 180 / 370
    expect(m.cvr).toBe(7.5676);            // 28 / 370 * 100
    expect(m.cpa).toBe(6.4286);            // 180 / 28
    expect(m.roas).toBe(3.6667);           // 660 / 180
  });

  it("division by zero gives null, never Infinity or NaN", () => {
    const m = computeMetrics(zero);
    expect([m.cpm, m.ctr, m.cpc, m.cvr, m.cpa, m.roas]).toEqual([null, null, null, null, null, null]);
    const noConv = computeMetrics({ ...zero, spend: 50, impressions: 1000, clicks: 10 });
    expect(noConv.cpa).toBeNull();
    expect(noConv.cvr).toBe(0); // 0 conversions out of 10 clicks is a valid 0%, not null
    expect(Object.values(noConv).every((v) => v === null || Number.isFinite(v))).toBe(true);
  });

  it("overall CTR comes from totals, not from the average of daily CTRs", () => {
    const day1 = { ...zero, impressions: 10, clicks: 5 };         // CTR 50%
    const day2 = { ...zero, impressions: 100_000, clicks: 1000 }; // CTR 1%
    const naiveAverage = (50 + 1) / 2;                             // 25.5% (wrong)
    const total = computeMetrics({
      ...zero, impressions: day1.impressions + day2.impressions, clicks: day1.clicks + day2.clicks,
    });
    expect(total.ctr).toBe(1.0049);
    expect(total.ctr).not.toBe(naiveAverage);
  });
});

describe("percentChange", () => {
  it("computes the change and returns null when it is undefined", () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(10, 0)).toBeNull();
    expect(percentChange(null, 10)).toBeNull();
    expect(percentChange(10, null)).toBeNull();
  });
  it("changeMap covers every metric", () => {
    const a = computeMetrics({ spend: 200, impressions: 1000, clicks: 10, conversions: 1, revenue: 400 });
    const b = computeMetrics({ spend: 100, impressions: 1000, clicks: 10, conversions: 1, revenue: 400 });
    const c = changeMap(a, b);
    expect(c.spend).toBe(100);
    expect(c.roas).toBe(-50);
    expect(c.impressions).toBe(0);
  });
});
