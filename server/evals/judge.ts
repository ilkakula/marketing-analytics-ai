import { z } from "zod";
import type { Finding } from "../src/modules/ai/findings";
import type { LlmProvider } from "../src/modules/ai/llm/provider";
import { describe } from "../src/modules/ai/templates";

// LLM-as-judge: scores the QUALITY of an answer (clarity, usefulness, completeness...). Arithmetic is
// not its job: numbers are checked deterministically by the validator. A judge is itself a model,
// so it is calibrated on purpose-built bad answers before its scores are trusted (see calibrate()).

export const DIMENSIONS = ["clarity", "actionability", "completeness", "conciseness", "calibration"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

const score = z.number().int().min(1).max(5);
export const judgeSchema = z.object({
  clarity: score, actionability: score, completeness: score, conciseness: score, calibration: score,
  notes: z.string().max(300),
});
export type JudgeScore = z.infer<typeof judgeSchema> & { overall: number };

export const judgeJsonSchema = (() => {
  const { $schema: _omit, ...rest } = z.toJSONSchema(judgeSchema) as Record<string, unknown>;
  return rest;
})();

export function judgePrompt(findings: Finding[], answer: unknown): string {
  const truth = findings.length
    ? findings.map((f) => `${f.id} [${f.severity}] ${describe(f, "USD").message}`).join("\n")
    : "(no findings: the account looks healthy)";
  return [
    "You are a strict reviewer of an AI-written analysis of ad campaign performance, written for a marketer.",
    "Score the ANSWER on five dimensions from 1 (poor) to 5 (excellent). Be strict: 5 is rare, 3 is acceptable, 1 is unusable.",
    "- clarity: plain, specific and easy to read; complete sentences; no filler or jargon pile-ups.",
    "- actionability: each recommendation names a concrete next step (what to check or change); generic advice such as 'monitor performance' or 'optimize campaigns' scores 1-2.",
    "- completeness: covers every HIGH priority finding and puts the most important first; ignoring a serious problem scores 1-2.",
    "- conciseness: no repetition or padding.",
    "- calibration: appropriately cautious; no unjustified claims about causes, no guarantees of results, and does not downplay serious problems.",
    "Judge the quality of the writing and reasoning only. Do NOT judge arithmetic: the numbers are verified elsewhere.",
    "",
    "FINDINGS (ground truth computed by rules):",
    truth,
    "",
    "ANSWER (JSON):",
    JSON.stringify(answer),
    "",
    "Return the five scores and a short note (max 40 words) naming the main weakness.",
  ].join("\n");
}

export async function judgeAnswer(provider: LlmProvider, findings: Finding[], answer: unknown): Promise<(JudgeScore & { model: string }) | null> {
  try {
    const { json, model } = await provider.generate({ prompt: judgePrompt(findings, answer), schema: judgeJsonSchema, temperature: 0 });
    const parsed = judgeSchema.safeParse(json);
    if (!parsed.success) return null;
    const s = parsed.data;
    return { ...s, overall: DIMENSIONS.reduce((a, d) => a + s[d], 0) / DIMENSIONS.length, model };
  } catch {
    return null; // judge unavailable: the answer is simply not scored
  }
}

export interface Calibration {
  scored: Array<{ name: string; kind: string; overall: number | null }>;
  separation: number;   // share of bad answers scored at least 0.8 below the solid one
  goodScore: number;
}

/** Scores the purpose-built corpus once: a trustworthy judge ranks the solid answer far above every bad one. */
export async function calibrateJudge(
  judge: LlmProvider, findings: Finding[], corpus: Array<{ name: string; kind: "good" | "bad"; answer: unknown }>, pauseMs = 1200,
): Promise<Calibration> {
  const scored: Calibration["scored"] = [];
  for (const c of corpus) {
    const j = await judgeAnswer(judge, findings, c.answer);
    scored.push({ name: c.name, kind: c.kind, overall: j ? Number(j.overall.toFixed(2)) : null });
    await new Promise((r) => setTimeout(r, pauseMs));
  }
  const good = scored.find((x) => x.kind === "good")?.overall ?? 0;
  const bad = scored.filter((x) => x.kind === "bad" && x.overall !== null);
  return { scored, goodScore: good, separation: bad.length ? bad.filter((x) => good - (x.overall as number) >= 0.8).length / bad.length : 0 };
}
