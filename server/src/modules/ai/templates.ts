import type { Finding } from "./findings";

const n = (v: number) => String(Math.round(v * 100) / 100); // dot as decimal separator, no thousands separators

export interface Described { message: string; action: string; reason: string }

// Deterministic wording: used as the fallback (no LLM) and as the "rules" view.
export function describe(f: Finding, cur: string): Described {
  const e = f.evidence;
  const name = `"${f.campaignName}"`;
  const m = (v: number) => `${n(v)} ${cur}`;
  switch (f.type) {
    case "LOSING_MONEY":
      return {
        message: `Campaign ${name} has a ROAS of ${n(e.roas!)} (revenue ${m(e.revenue!)} on spend ${m(e.spend!)}) and takes ${n(e.spendSharePct!)}% of the budget.`,
        action: `Review or pause campaign ${name}`,
        reason: `A ROAS below 1 means the campaign returns less revenue than it costs (spend ${m(e.spend!)}, revenue ${m(e.revenue!)}).`,
      };
    case "HIGH_CPC":
      return {
        message: `CPC of campaign ${name} is ${m(e.cpc!)}, ${n(e.percentAboveWorkspace!)}% above the workspace average (${m(e.workspaceCpc!)}).`,
        action: `Review creatives and targeting of campaign ${name}`,
        reason: `Clicks cost more than average (${m(e.cpc!)} vs ${m(e.workspaceCpc!)}). The data shows the gap, not its cause.`,
      };
    case "CPC_SPIKE":
      return {
        message: `CPC of campaign ${name} rose from ${m(e.previousCpc!)} to ${m(e.cpc!)} (+${n(e.percentChange!)}%) versus the previous period.`,
        action: `Check what changed in campaign ${name} during this period`,
        reason: `CPC jumped from ${m(e.previousCpc!)} to ${m(e.cpc!)}. Timing alone does not prove a cause.`,
      };
    case "ROAS_DROP":
      return {
        message: `ROAS of campaign ${name} fell from ${n(e.previousRoas!)} to ${n(e.roas!)} (${n(e.percentChange!)}%) versus the previous period.`,
        action: `Investigate the ROAS decline of campaign ${name}`,
        reason: `ROAS fell from ${n(e.previousRoas!)} to ${n(e.roas!)}.`,
      };
    case "CONVERSION_DECLINE":
      return {
        message: `Conversions of campaign ${name} declined for ${n(e.weeks!)} weeks in a row: from ${n(e.firstWeekConversions!)} to ${n(e.lastWeekConversions!)} per week (-${n(e.percentDrop!)}%).`,
        action: `Check creatives, audience and landing page of campaign ${name}`,
        reason: `Weekly conversions fell ${n(e.weeks!)} weeks in a row (from ${n(e.firstWeekConversions!)} to ${n(e.lastWeekConversions!)}).`,
      };
    case "SPEND_ANOMALY":
      return {
        message: `Campaign ${name} spent ${m(e.spend!)} on ${f.date}, ${n(e.percentAboveBaseline!)}% above its usual ${m(e.baselineSpend!)} per day.`,
        action: `Check the budget and delivery settings of campaign ${name} for ${f.date}`,
        reason: `Daily spend of ${m(e.spend!)} deviates sharply from the usual ${m(e.baselineSpend!)}. The data does not show why the spike happened.`,
      };
    case "CONVERSIONS_ANOMALY":
      return {
        message: `Campaign ${name} had only ${n(e.conversions!)} conversions on ${f.date}, ${n(e.percentBelowBaseline!)}% below its usual ${n(e.baselineConversions!)} per day, while spending ${m(e.spend!)}.`,
        action: `Check conversion tracking and the status of campaign ${name} for ${f.date}`,
        reason: `The campaign kept spending (${m(e.spend!)}) while conversions fell from a usual ${n(e.baselineConversions!)} to ${n(e.conversions!)}. A tracking issue is possible, but the data does not confirm it.`,
      };
    case "NO_CONVERSIONS":
      return {
        message: `Campaign ${name} spent ${m(e.spend!)} (${n(e.spendSharePct!)}% of the budget) and received ${n(e.clicks!)} clicks, but recorded no conversions.`,
        action: `Check conversion tracking and the landing page of campaign ${name}`,
        reason: `${n(e.clicks!)} clicks and ${m(e.spend!)} of spend produced no conversions. Broken tracking and a poorly converting offer look the same in this data.`,
      };
    case "LOW_CTR":
      return {
        message: `CTR of campaign ${name} is ${n(e.ctr!)}%, ${n(e.percentBelowWorkspace!)}% below the workspace average (${n(e.workspaceCtr!)}%) across ${n(e.impressions!)} impressions.`,
        action: `Review the creatives and targeting of campaign ${name}`,
        reason: `Few people click (${n(e.ctr!)}% against an average of ${n(e.workspaceCtr!)}%). The data shows the gap, not whether the creative or the audience is the reason.`,
      };
    case "BELOW_TARGET_ROAS":
      return {
        message: `Campaign ${name} has a ROAS of ${n(e.roas!)}, ${n(e.percentBelowTarget!)}% below your target of ${n(e.targetRoas!)}, while taking ${n(e.spendSharePct!)}% of the budget.`,
        action: `Look for ways to lift the ROAS of campaign ${name} toward the target`,
        reason: `The campaign is profitable (ROAS ${n(e.roas!)}) but under your target of ${n(e.targetRoas!)}.`,
      };
    case "TOP_PERFORMER":
      return {
        message: `Campaign ${name} has the best ROAS (${n(e.roas!)}), ${n(e.roasVsWorkspace!)}x the workspace average (${n(e.workspaceRoas!)}).`,
        action: `Consider gradually increasing the budget for ${name}`,
        reason: `ROAS ${n(e.roas!)} versus an average of ${n(e.workspaceRoas!)} at meaningful spend. A larger budget does not guarantee the same ROAS.`,
      };
  }
}

export interface RulesInsights {
  summary: string;
  observations: string[];
  recommendations: Array<{ action: string; reason: string; basedOn: string[] }>;
}

export function rulesInsights(
  findings: Finding[], totals: { spend: number; revenue: number; roas: number | null }, cur: string,
): RulesInsights {
  const roas = totals.roas === null ? "-" : n(totals.roas);
  const head = `In the selected period ${n(totals.spend)} ${cur} was spent and revenue was ${n(totals.revenue)} ${cur} (ROAS ${roas}).`;
  const attention = findings.filter((f) => f.severity !== "info").length;
  const tail = totals.spend === 0
    ? " There is no data for this period."
    : attention === 0
      ? " No campaign breaches the monitoring rules."
      : ` ${attention} findings need attention.`;
  const described = findings.map((f) => ({ f, d: describe(f, cur) }));
  return {
    summary: head + tail,
    observations: described.slice(0, 6).map(({ d }) => d.message),
    recommendations: described.slice(0, 5).map(({ f, d }) => ({ action: d.action, reason: d.reason, basedOn: [f.id] })),
  };
}
