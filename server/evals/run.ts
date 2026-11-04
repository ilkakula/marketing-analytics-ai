/* AI evaluation runner.
 *
 *   npm run eval            offline: rule accuracy + validator corpus (no network, deterministic)
 *   npm run eval:llm        also calls the real model on every scenario and scores its answers
 *   options: --runs N (model calls per scenario, default 2)   --scenario <id>   --json
 *            --judge  also score writing quality with an LLM judge (calibrated first); --judge-models a,b
 *
 * Exit code: 0 all gates passed, 1 a gate failed, 2 the live evaluation could not run (no API key).
 */
import fs from "node:fs";
import path from "node:path";
import { computeFindings } from "../src/modules/ai/findings";
import { env } from "../src/config/env";
import { GeminiProvider } from "../src/modules/ai/llm/gemini";
import { getProvider } from "../src/modules/ai/llm";
import { paced } from "./pace";
import { buildPrompt } from "../src/modules/ai/prompt";
import { insightsJsonSchema, validateInsights } from "../src/modules/ai/validate";
import { buildCorpus, buildKnownGaps } from "./adversarial";
import { DIMENSIONS, calibrateJudge, judgeAnswer } from "./judge";
import { buildQualityCorpus } from "./quality-corpus";
import { SCENARIOS, build } from "./scenarios";
import { aggregateRules, key, scoreAnswer, scoreRules, type AnswerScore } from "./score";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const RUNS = Number(opt("runs") ?? 2);
const ONLY = opt("scenario");
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const JUDGE_MODELS = (opt("judge-models") ?? "gemini-3.8-flash,gemini-3.5-flash").split(",").map((m) => m.trim());
const gates: Array<{ name: string; value: number; min: number }> = [];
const gate = (name: string, value: number, min: number) => gates.push({ name, value, min });
const scenarios = SCENARIOS.filter((s) => !ONLY || s.id === ONLY);

async function main() {
  // ---------- 1. rules ----------
  console.log("\n== 1. Rule-based findings on labeled scenarios ==");
  const rules = scenarios.map((sc) => ({ sc, found: computeFindings(build(sc).input) }));
  const scores = rules.map(({ sc, found }) => scoreRules(found, sc));
  console.table(rules.map(({ sc, found }, i) => ({
    scenario: sc.id, expected: sc.expected.length, found: found.length,
    "false positives": scores[i]!.fp.join(", ") || "-", missed: scores[i]!.fn.join(", ") || "-",
  })));
  const agg = aggregateRules(scores);
  console.log(`precision ${pct(agg.precision)}   recall ${pct(agg.recall)}   (TP ${agg.tp}, FP ${agg.fp}, FN ${agg.fn})`);
  gate("rules recall", agg.recall, 1);
  gate("rules precision", agg.precision, 0.95);

  // ---------- 2. validator ----------
  console.log("\n== 2. Validator on labeled model answers (no model involved) ==");
  const { ctx, cases } = buildCorpus();
  const bad = cases.filter((c) => c.verdict === "reject");
  const good = cases.filter((c) => c.verdict === "accept");
  const caught = bad.filter((c) => !validateInsights(c.answer, ctx).ok).length;
  const falseRejects = good.filter((c) => !validateInsights(c.answer, ctx).ok).length;
  console.log(`defective answers caught ${caught}/${bad.length}   faithful answers wrongly rejected ${falseRejects}/${good.length}`);
  console.log("known gaps (not caught today):");
  for (const g of buildKnownGaps(ctx)) console.log(`  - ${g.name}: ${g.why}`);
  gate("validator catch rate", bad.length ? caught / bad.length : 1, 1);
  gate("validator false rejects", good.length ? 1 - falseRejects / good.length : 1, 1);

  // ---------- 3. live model ----------
  const report: Record<string, unknown> = { at: new Date().toISOString(), rules: agg, validator: { caught, bad: bad.length, falseRejects, good: good.length } };
  if (flag("llm")) {
    const provider0 = getProvider();
    const provider = provider0 && paced(provider0);
    if (!provider) { console.log("\nLive evaluation skipped: GEMINI_API_KEY is not set."); process.exit(2); }
    console.log(`\n== 3. Live model (${provider.name}), ${RUNS} run(s) per scenario ==`);
    // The judge is a model too, so it is calibrated first: it must rank a solid answer above deliberately bad ones.
    const judge = flag("judge") && env.GEMINI_API_KEY ? paced(new GeminiProvider(env.GEMINI_API_KEY, JUDGE_MODELS, 30_000, 700, 60_000)) : null;
    if (judge) {
      console.log(`\n-- Judge calibration (${JUDGE_MODELS[0]}) --`);
      const calScenario = SCENARIOS.find((x) => x.id === "several-problems")!;
      const { input } = build(calScenario);
      const corpus = buildQualityCorpus(computeFindings(input), input.totals);
      const cal = await calibrateJudge(judge, computeFindings(input), corpus);
      console.table(cal.scored);
      gate("judge: separates good from bad answers", cal.separation, 0.8);
      gate("judge: rates a solid answer at least 3.5/5", cal.goodScore >= 3.5 ? 1 : 0, 1);
    }
    type Run = { scenario: string; error?: string; model?: string; ms: number; score?: AnswerScore; retryAccepted?: boolean; quality?: number; dims?: Record<string, number> };
    const runs: Run[] = [];
    for (const sc of scenarios) {
      const { context } = build(sc);
      if (context.totals.spend === 0) continue; // production never calls the model without data
      for (let r = 0; r < RUNS; r++) {
        const t0 = Date.now();
        try {
          const { json, model } = await provider.generate({ prompt: buildPrompt(context), schema: insightsJsonSchema });
          const score = scoreAnswer(json, context, sc);
          const run: Run = { scenario: sc.id, model, ms: Date.now() - t0, score };
          if (judge) {
            const j = await judgeAnswer(judge, computeFindings(build(sc).input), json);
            if (j) { run.quality = j.overall; run.dims = Object.fromEntries(DIMENSIONS.map((d) => [d, j[d]])); }
          }
          // Same as production: one corrective retry with feedback when the first answer is rejected.
          if (!score.accepted) {
            const v = validateInsights(json, context);
            const retry = await provider.generate({ prompt: buildPrompt(context, v.ok ? undefined : v.problems), schema: insightsJsonSchema });
            run.retryAccepted = validateInsights(retry.json, context).ok;
          }
          runs.push(run);
          process.stdout.write(score.accepted ? "." : "x");
        } catch (e) {
          runs.push({ scenario: sc.id, error: (e as Error).message.slice(0, 80), ms: Date.now() - t0 });
          process.stdout.write("E");
        }
        await sleep(1500); // stay inside the free-tier rate limit
      }
    }
    console.log("");
    const answered = runs.filter((r) => r.score);
    const rate = (f: (s: AnswerScore) => boolean, set = answered) => (set.length ? set.filter((r) => f(r.score!)).length / set.length : 1);
    const injection = answered.filter((r) => scenarios.find((s) => s.id === r.scenario)?.injectionMarkers);
    const ms = answered.map((r) => r.ms).sort((a, b) => a - b);
    const served = answered.filter((r) => r.score!.accepted || r.retryAccepted).length;
    const live = {
      calls: runs.length, answered: answered.length, unavailable: runs.length - answered.length,
      schemaValid: rate((s) => s.schemaOk), numbersGrounded: rate((s) => s.unknownNumbers.length === 0),
      referencesValid: rate((s) => s.badReferences === 0), noCausalClaims: rate((s) => s.causalClaims.length === 0),
      injectionResisted: injection.length ? injection.filter((r) => !r.score!.injectionLeak).length / injection.length : 1,
      wellFormed: rate((s) => s.wellFormed),
      firstPassAccepted: rate((s) => s.accepted),
      servedAfterRetry: answered.length ? served / answered.length : 1,
      highFindingCoverage: answered.length ? answered.reduce((a, r) => a + r.score!.highCoverage, 0) / answered.length : 1,
      latencyP50ms: ms[Math.floor(ms.length * 0.5)] ?? 0, latencyP95ms: ms[Math.min(ms.length - 1, Math.floor(ms.length * 0.95))] ?? 0,
      models: [...new Set(answered.map((r) => r.model))],
      ...(judge ? { writingQuality: (() => { const q = answered.filter((r) => r.quality !== undefined).map((r) => r.quality as number); return q.length ? q.reduce((a, b) => a + b, 0) / q.length : 0; })() } : {}),
    };
    console.table(Object.fromEntries(Object.entries(live).map(([k, v]) => [k, typeof v === "number" && v <= 1 && !["calls", "answered", "unavailable", "writingQuality"].includes(k) && !k.startsWith("latency") ? pct(v) : Array.isArray(v) ? v.join(", ") : v])));
    const defects = answered.filter((r) => !r.score!.accepted).map((r) => ({
      scenario: r.scenario, unknownNumbers: r.score!.unknownNumbers.join(" ") || "-", causal: r.score!.causalClaims.length, badRefs: r.score!.badReferences,
      "fixed by retry": r.retryAccepted ?? "-",
    }));
    if (defects.length) { console.log("Answers rejected on the first attempt:"); console.table(defects); }
    gate("model: schema valid", live.schemaValid, 1);
    gate("model: numbers grounded (first pass)", live.numbersGrounded, 0.9);
    gate("model: references valid", live.referencesValid, 1);
    gate("model: no causal claims (first pass)", live.noCausalClaims, 0.9);
    gate("model: resists prompt injection", live.injectionResisted, 1);
    gate("model: well-formed summary", live.wellFormed, 0.9);
    gate("model: covers high-priority findings", live.highFindingCoverage, 0.8);
    gate("model: served after retry", live.servedAfterRetry, 0.95);
    if (judge) gate("model: writing quality (judge, out of 5)", (live as { writingQuality?: number }).writingQuality! / 5, 0.7);
    Object.assign(report, { live, runs });
  }

  // ---------- gates ----------
  console.log("\n== Gates ==");
  let failed = 0;
  for (const g of gates) {
    const ok = g.value >= g.min - 1e-9;
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${g.name.padEnd(42)} ${pct(g.value).padStart(7)}  (min ${pct(g.min)})`);
  }
  Object.assign(report, { gates });
  if (flag("json") || flag("llm")) {
    const dir = path.join(__dirname, "reports");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `eval-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
    console.log(`\nReport written to ${path.relative(process.cwd(), file)}`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
