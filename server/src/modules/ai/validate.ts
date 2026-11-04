import { z } from "zod";
import type { AiContext } from "./context";
import { numberPool } from "./context";

export const insightsSchema = z.object({
  summary: z.string().min(1).max(700),
  observations: z.array(z.string().min(1).max(450)).max(6),
  recommendations: z
    .array(z.object({
      action: z.string().min(1).max(220),
      reason: z.string().min(1).max(550),
      basedOn: z.array(z.string()).max(5),
    }))
    .max(5),
});
export type Insights = z.infer<typeof insightsSchema>;

/** JSON schema for the model (Gemini responseJsonSchema). */
export const insightsJsonSchema = (() => {
  const { $schema: _omit, ...rest } = z.toJSONSchema(insightsSchema) as Record<string, unknown>;
  return rest;
})();

const NUMBER_RE = /(\d+(?:[.,]\d+)*)(\s?(?:k|m)\b)?/gi;

/** Interpretations of one written number: "1.250" can be 1.25 or 1250; "20,610" is 20610. */
function candidates(raw: string, suffix: string | undefined): number[] {
  const mult = suffix ? (suffix.trim().toLowerCase() === "k" ? 1e3 : 1e6) : 1;
  const out = new Set<number>();
  const plain = Number(raw.replace(",", "."));
  if (Number.isFinite(plain)) out.add(plain);
  if (/^\d{1,3}([.,]\d{3})+$/.test(raw)) out.add(Number(raw.replace(/[.,]/g, "")));
  if (/^\d{1,3}(,\d{3})+\.\d+$/.test(raw)) out.add(Number(raw.replace(/,/g, "")));
  return [...out].map((v) => v * mult);
}

// Compares absolute values: the evidence holds a drop of -26.94, and the model rightly writes "fell by 26.94%".
const close = (a: number, b: number) => Math.abs(Math.abs(a) - Math.abs(b)) <= Math.max(0.011, Math.abs(b) * 0.015);

/**
 * Returns the numbers in the text that do NOT exist in the context (invented or recomputed).
 * Ignores: dates, campaign names, finding IDs and whole numbers up to 10 (weeks, ordinals).
 */
export function findUnknownNumbers(texts: string[], ctx: AiContext): string[] {
  const names = ctx.topCampaigns.map((c) => c.name).concat(ctx.findings.map((f) => f.campaign));
  return findUnknownNumbersIn(texts, numberPool(ctx), names);
}

/** Same check against an arbitrary pool of allowed numbers (used by "ask your data" on tool results). */
export function findUnknownNumbersIn(texts: string[], pool: number[], campaignNames: string[]): string[] {
  const names = campaignNames.filter(Boolean).sort((a, b) => b.length - a.length);
  const unknown: string[] = [];
  for (let text of texts) {
    for (const nm of names) text = text.split(nm).join(" ");
    text = text.replace(/\d{4}-\d{2}-\d{2}/g, " ").replace(/\bF\d+\b/g, " ");
    for (const m of text.matchAll(NUMBER_RE)) {
      const [whole, raw = "", suffix] = m;
      const cands = candidates(raw, suffix);
      if (cands.some((c) => Number.isInteger(c) && c >= 0 && c <= 10)) continue;
      if (!cands.some((c) => pool.some((p) => close(c, p)))) unknown.push(whole.trim());
    }
  }
  return unknown;
}

// Explicit causal wording. The data only shows correlation, so such a claim must be hedged
// ("may", "could", "coincides with"...). Bare "because" is not flagged: "review X because ROAS is
// below 1" justifies an action, it does not assert the cause of a result.
const CAUSAL = /\b(caused by|caused|due to|as a result of|resulted from|result of|thanks to|driven by|the reason (?:for|of|why)|led to|leads to|is responsible for|attributable to)\b/i;
const HEDGE = /\b(may|might|could|possibly|potentially|perhaps|suggests?|coincides?|correlat\w*|appears?|likely|seems?|not (?:prove|confirm|show|establish)|does not (?:prove|confirm|show|establish)|cannot)\b/i;

/** Sentences that state a cause as fact (causal phrase without any hedge in the same sentence). */
export function findCausalClaims(texts: string[]): string[] {
  const out: string[] = [];
  for (const text of texts) {
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      if (CAUSAL.test(sentence) && !HEDGE.test(sentence)) out.push(sentence.trim().slice(0, 120));
    }
  }
  return out;
}

export type Verdict = { ok: true; insights: Insights } | { ok: false; problems: string[] };

export function validateInsights(raw: unknown, ctx: AiContext): Verdict {
  const parsed = insightsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: [`The answer does not follow the schema: ${parsed.error.issues[0]?.message ?? "unknown"}`] };
  const ins = parsed.data;
  const problems: string[] = [];

  const ids = new Set(ctx.findings.map((f) => f.id));
  for (const r of ins.recommendations) {
    if (ids.size > 0 && r.basedOn.length === 0) problems.push("Recommendation without 'basedOn'.");
    for (const id of r.basedOn) if (!ids.has(id)) problems.push(`Unknown finding in 'basedOn': ${id}`);
  }
  if (ids.size === 0 && ins.recommendations.length > 0) problems.push("Recommendations without any findings in the data.");

  const texts = [ins.summary, ...ins.observations, ...ins.recommendations.flatMap((r) => [r.action, r.reason])];
  const unknown = findUnknownNumbers(texts, ctx);
  if (unknown.length) problems.push(`Numbers that do not exist in the data: ${[...new Set(unknown)].slice(0, 5).join(", ")}`);

  const causal = findCausalClaims(texts);
  if (causal.length) problems.push(`Causal claim stated as fact (the data shows correlation only): "${causal[0]}"`);

  return problems.length ? { ok: false, problems } : { ok: true, insights: ins };
}
