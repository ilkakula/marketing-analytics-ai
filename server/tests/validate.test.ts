import { buildContext } from "../src/modules/ai/context";
import { computeFindings } from "../src/modules/ai/findings";
import { findCausalClaims, findUnknownNumbers, validateInsights } from "../src/modules/ai/validate";
import { computeMetrics } from "../src/modules/analytics/metrics";

const totals = computeMetrics({ spend: 20610, impressions: 2604939, clicks: 28302, conversions: 345, revenue: 16835 });
const camps = [{ id: "x", name: "Summer Sale 2026", ...totals }];
const findings = computeFindings({ totals, campaigns: camps, weekly: [] });
const ctx = buildContext({ from: "2026-10-01", to: "2026-10-30", currency: "USD", totals, campaigns: camps, findings });

describe("findUnknownNumbers", () => {
  it("accepts numbers from the context and reasonable rounding", () => {
    expect(findUnknownNumbers(["Spend is 20610, revenue 16835, ROAS 0.82."], ctx)).toEqual([]);
    expect(findUnknownNumbers(["Spent 20.6K, precisely 20,610 USD."], ctx)).toEqual([]);
    expect(findUnknownNumbers(["CPC je 0.73, CTR 1.09%."], ctx)).toEqual([]);
  });
  it("compares absolute values (a decline is written without a minus sign)", () => {
    const withDrop = { ...ctx, findings: [{ id: "F1", type: "ROAS_DROP", severity: "high", campaign: "X", evidence: { percentChange: -26.94 } }] };
    expect(findUnknownNumbers(["ROAS fell by 26.94%."], withDrop)).toEqual([]);
  });
  it("rejects invented and recomputed numbers", () => {
    expect(findUnknownNumbers(["The campaign lost 3775 USD."], ctx)).toEqual(["3775"]); // 20610 - 16835, not in the data
    expect(findUnknownNumbers(["ROAS je 5.4."], ctx)).toEqual(["5.4"]);
  });
  it("ignores dates, campaign names, finding IDs and small whole numbers", () => {
    expect(findUnknownNumbers(["Campaign Summer Sale 2026 (F1) from 2026-10-01 declines for 3 weeks."], ctx)).toEqual([]);
  });
});

describe("validateInsights", () => {
  const good = { summary: "ROAS je 0.82.", observations: [], recommendations: [{ action: "Pauzirati", reason: "ROAS 0.82", basedOn: ["F1"] }] };
  it("accepts a valid answer", () => { expect(validateInsights(good, ctx).ok).toBe(true); });
  it("rejects a wrong schema, an unknown finding and a recommendation without a basis", () => {
    expect(validateInsights({ summary: 5 }, ctx).ok).toBe(false);
    const bad = validateInsights({ ...good, recommendations: [{ ...good.recommendations[0], basedOn: ["F9"] }] }, ctx);
    expect(bad.ok === false && bad.problems.join()).toContain("F9");
    const noBasis = validateInsights({ ...good, recommendations: [{ ...good.recommendations[0], basedOn: [] }] }, ctx);
    expect(noBasis.ok).toBe(false);
  });
  it("rejects an answer with an invented number", () => {
    const v = validateInsights({ ...good, summary: "Lost 3775 USD." }, ctx);
    expect(v.ok === false && v.problems.join()).toContain("3775");
  });
});


describe("findCausalClaims", () => {
  it("flags causal wording stated as fact", () => {
    expect(findCausalClaims(["The drop was caused by the new creative."])).toHaveLength(1);
    expect(findCausalClaims(["Spend rose due to a budget change."])).toHaveLength(1);
    expect(findCausalClaims(["Revenue fell as a result of the CPC increase. ROAS is 0.82."])).toHaveLength(1);
  });
  it("accepts hedged wording and justifications that do not assert a cause", () => {
    expect(findCausalClaims(["The drop may be due to the new creative."])).toEqual([]);
    expect(findCausalClaims(["The spike coincides with the budget change, which does not prove a cause."])).toEqual([]);
    expect(findCausalClaims(["Review campaign X because its ROAS is below 1."])).toEqual([]);
    expect(findCausalClaims(["ROAS fell from 4.03 to 2.95."])).toEqual([]);
  });
  it("rejects an otherwise valid answer that asserts a cause", () => {
    const valid = { summary: "ROAS is 0.82.", observations: [], recommendations: [{ action: "Pause", reason: "ROAS 0.82", basedOn: ["F1"] }] };
    const withCause = { ...valid, summary: "ROAS is 0.82, caused by weak creatives." };
    expect(validateInsights(valid, ctx).ok).toBe(true);
    const v = validateInsights(withCause, ctx);
    expect(v.ok === false && v.problems.join()).toContain("Causal claim");
  });
});
