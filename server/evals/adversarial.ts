import type { AiContext } from "../src/modules/ai/context";
import { SCENARIOS, build } from "./scenarios";

// A labeled corpus of model answers. "accept" answers are faithful to the data; "reject" answers
// contain exactly one kind of defect each. It measures the VALIDATOR itself (not the model): how
// many bad answers it catches and how many good ones it wrongly rejects. No network needed.

export interface AdversarialCase { name: string; verdict: "accept" | "reject"; answer: unknown }

const base = (summary: string, extra: Record<string, unknown> = {}) => ({
  summary, observations: [], recommendations: [{ action: "Review the campaign", reason: "ROAS is below 1.", basedOn: ["F1"] }], ...extra,
});

/**
 * Defects the validator CANNOT catch today. They are documented (and pinned by a test) instead of
 * hidden: the number check proves a number exists somewhere in the data, not that it is attached to
 * the right metric, and campaign names in free text are not verified.
 */
export interface KnownGap { name: string; why: string; answer: unknown }

export function buildKnownGaps(ctx: AiContext): KnownGap[] {
  const e = ctx.findings.find((x) => x.id === "F1")!.evidence as Record<string, number>;
  return [
    { name: "real number attached to the wrong metric",
      why: "the number exists in the data (budget share), but the answer calls it a ROAS decline",
      answer: base(`ROAS fell by ${e.spendSharePct}% last week.`) },
    { name: "recommendation about a campaign that does not exist",
      why: "campaign names in free text are not checked against the data",
      answer: base("Pause the campaign Winter Clearance.") },
  ];
}

export function buildCorpus(): { ctx: AiContext; cases: AdversarialCase[] } {
  const sc = SCENARIOS.find((s) => s.id === "money-loser")!;
  const { context: ctx } = build(sc);
  const f = ctx.findings.find((x) => x.id === "F1")!;
  const e = f.evidence as Record<string, number>;
  const name = f.campaign;
  const swapDigits = (n: number) => { const t = String(Math.round(n)); return t.length < 3 ? t : t[0]! + t[2]! + t[1]! + t.slice(3); };

  const cases: AdversarialCase[] = [
    // ----- faithful answers: must be accepted -----
    { name: "faithful: cites evidence numbers", verdict: "accept",
      answer: base(`${name} has a ROAS of ${e.roas} on a spend of ${e.spend} USD.`, { recommendations: [{ action: `Review ${name}`, reason: `Revenue ${e.revenue} USD on spend ${e.spend} USD.`, basedOn: ["F1"] }] }) },
    { name: "faithful: compact K notation", verdict: "accept", answer: base(`${name} spent ${(e.spend! / 1000).toFixed(1)}K USD.`) },
    { name: "faithful: share of budget", verdict: "accept", answer: base(`${name} takes ${e.spendSharePct}% of the budget.`) },
    { name: "faithful: hedged cause", verdict: "accept", answer: base(`The low ROAS of ${e.roas} may be due to weak creatives, which the data cannot confirm.`) },
    { name: "faithful: nothing to add", verdict: "accept", answer: { summary: "Everything looks stable.", observations: [], recommendations: [] } },
    { name: "faithful: small ordinals and weeks", verdict: "accept", answer: base("Review the 3 largest campaigns over the last 2 weeks.") },

    // ----- defective answers: must be rejected -----
    { name: "invented total loss", verdict: "reject", answer: base(`${name} lost 4500 USD.`) },
    { name: "derived number (spend minus revenue)", verdict: "reject", answer: base(`${name} lost ${Math.round(e.spend! - e.revenue!)} USD.`) },
    { name: "digit transposition in spend", verdict: "reject", answer: base(`${name} spent ${swapDigits(e.spend!)} USD.`) },
    { name: "invented percentage", verdict: "reject", answer: base(`${name} dropped by 62.7% last week.`) },
    { name: "future projection", verdict: "reject", answer: base(`ROAS could reach 3.5 after pausing ${name}.`) },
    { name: "invented figure in another currency", verdict: "reject", answer: base(`${name} wasted about 19000 EUR.`) },
    { name: "unknown finding id", verdict: "reject", answer: base("ROAS is low.", { recommendations: [{ action: "Review", reason: "Low ROAS.", basedOn: ["F9"] }] }) },
    { name: "recommendation without basedOn", verdict: "reject", answer: base("ROAS is low.", { recommendations: [{ action: "Review", reason: "Low ROAS.", basedOn: [] }] }) },
    { name: "missing summary", verdict: "reject", answer: { observations: [], recommendations: [] } },
    { name: "observations is not an array", verdict: "reject", answer: { summary: "x", observations: "none", recommendations: [] } },
    { name: "too many recommendations", verdict: "reject", answer: base("x", { recommendations: Array.from({ length: 6 }, () => ({ action: "a", reason: "r", basedOn: ["F1"] })) }) },
    { name: "cause stated as fact (caused by)", verdict: "reject", answer: base(`The weak ROAS of ${e.roas} was caused by poor creatives.`) },
    { name: "cause stated as fact (as a result of)", verdict: "reject", answer: base(`Revenue is low as a result of the high CPC in ${name}.`) },
  ];
  return { ctx, cases };
}
