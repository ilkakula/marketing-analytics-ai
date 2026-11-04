import type { Finding } from "../src/modules/ai/findings";
import { rulesInsights } from "../src/modules/ai/templates";

// A labeled corpus for CALIBRATING the judge: one solid answer and answers that are each bad in a known way.
// If the judge cannot tell them apart, its scores on real model output mean nothing.

export interface QualityCase { name: string; kind: "good" | "bad"; answer: unknown }

export function buildQualityCorpus(findings: Finding[], totals: { spend: number; revenue: number; roas: number | null }): QualityCase[] {
  const good = rulesInsights(findings, totals, "USD"); // concrete, complete, cautious, ordered by priority
  const first = findings.find((f) => f.severity === "high") ?? findings[0];
  const ref = first ? [first.id] : [];
  const repeated = good.observations[0] ?? "Performance should be reviewed.";
  return [
    { name: "solid answer", kind: "good", answer: good },
    { name: "vague generic advice", kind: "bad", answer: {
      summary: "Overall performance is mixed, with some campaigns doing well while others could be improved over time.",
      observations: ["Some campaigns perform better than others.", "There is room for optimization across the account."],
      recommendations: [
        { action: "Monitor performance", reason: "Keeping an eye on results is important.", basedOn: ref },
        { action: "Optimize campaigns", reason: "Optimization can improve results.", basedOn: ref },
        { action: "Test new creatives", reason: "Testing is a good practice.", basedOn: ref },
      ] } },
    { name: "truncated answer", kind: "bad", answer: {
      summary: "The campaign Summer",
      observations: [],
      recommendations: [{ action: "Review", reason: "See", basedOn: ref }] } },
    { name: "repetitive padding", kind: "bad", answer: {
      summary: good.summary,
      observations: [repeated, repeated, repeated, repeated, repeated],
      recommendations: good.recommendations.slice(0, 1) } },
    { name: "ignores the serious problems", kind: "bad", answer: {
      summary: "Everything looks fine and the account is performing well overall.",
      observations: ["Revenue is healthy."],
      recommendations: [{ action: "Keep doing what you are doing", reason: "Results are good.", basedOn: ref }] } },
    { name: "overclaims and guarantees", kind: "bad", answer: {
      summary: good.summary,
      observations: [],
      recommendations: [{ action: "Pause the worst campaign immediately", reason: "This will definitely fix the account and guarantees much better results, because the campaign is simply broken.", basedOn: ref }] } },
  ];
}
