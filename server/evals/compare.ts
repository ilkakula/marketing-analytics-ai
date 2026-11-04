/* Model comparison: runs the same scenarios through several models and compares quality, speed and tokens.
 *
 *   npm run eval:compare -- --models gemini-3.5-flash-lite,gemini-3.8-flash --runs 2 [--judge-models a,b] [--no-judge]
 *
 * Every model is called alone (no fallback chain), so results are attributable to that model.
 * The judge is a different, stronger model by default, to avoid a model grading its own writing.
 */
import fs from "node:fs";
import path from "node:path";
import { env } from "../src/config/env";
import { computeFindings } from "../src/modules/ai/findings";
import { GeminiProvider } from "../src/modules/ai/llm/gemini";
import { buildPrompt } from "../src/modules/ai/prompt";
import { paced } from "./pace";
import { insightsJsonSchema } from "../src/modules/ai/validate";
import { DIMENSIONS, calibrateJudge, judgeAnswer } from "./judge";
import { buildQualityCorpus } from "./quality-corpus";
import { SCENARIOS, build } from "./scenarios";
import { scoreAnswer } from "./score";

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const MODELS = (opt("models") ?? env.GEMINI_MODELS).split(",").map((s) => s.trim()).filter(Boolean);
const JUDGE_MODELS = (opt("judge-models") ?? "gemini-3.8-flash,gemini-3.5-flash").split(",").map((s) => s.trim());
const RUNS = Number(opt("runs") ?? 2);
const JUDGE = !args.includes("--no-judge");
const pct = (x: number) => (Number.isNaN(x) ? "n/a" : `${(x * 100).toFixed(0)}%`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))]! : 0; };
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

async function main() {
  if (!env.GEMINI_API_KEY) { console.log("GEMINI_API_KEY is not set."); process.exit(2); }
  const judge = JUDGE ? paced(new GeminiProvider(env.GEMINI_API_KEY, JUDGE_MODELS, 30_000, 700, 60_000)) : null;
  const scenarios = SCENARIOS.filter((s) => build(s).context.totals.spend > 0);
  console.log(`Comparing ${MODELS.join(" vs ")} on ${scenarios.length} scenarios x ${RUNS} runs${judge ? `, judged by ${JUDGE_MODELS[0]}` : ""}`);

  let calibration: Awaited<ReturnType<typeof calibrateJudge>> | null = null;
  if (judge) {
    // A judge is a model too: it must rank a solid answer above deliberately bad ones before its scores count.
    const cal = SCENARIOS.find((x) => x.id === "several-problems")!;
    const { input } = build(cal);
    calibration = await calibrateJudge(judge, computeFindings(input), buildQualityCorpus(computeFindings(input), input.totals));
    console.log(`judge calibration: solid answer ${calibration.goodScore}/5, bad answers separated ${pct(calibration.separation)}` +
      (calibration.separation < 0.8 || calibration.goodScore < 3.5 ? "   <-- UNRELIABLE JUDGE, ignore the quality scores" : ""));
  }

  const results: Record<string, ReturnType<typeof summarize>> = {};
  for (const model of MODELS) {
    const provider = paced(new GeminiProvider(env.GEMINI_API_KEY, [model], 30_000, 700, 60_000));
    const rows: Row[] = [];
    process.stdout.write(`${model.padEnd(24)} `);
    for (const sc of scenarios) {
      const { input, context } = build(sc);
      const findings = computeFindings(input);
      for (let r = 0; r < RUNS; r++) {
        const t0 = Date.now();
        try {
          const { json, usage } = await provider.generate({ prompt: buildPrompt(context), schema: insightsJsonSchema });
          const ms = Date.now() - t0;
          const sc2 = scoreAnswer(json, context, sc);
          const j = judge ? await judgeAnswer(judge, findings, json) : null;
          rows.push({ ok: true, ms, usage, score: sc2, judge: j });
          process.stdout.write(sc2.accepted ? "." : "x");
        } catch { rows.push({ ok: false, ms: Date.now() - t0 }); process.stdout.write("E"); }
        await sleep(1200);
      }
    }
    console.log("");
    results[model] = summarize(rows);
  }

  // ---------- report ----------
  const fmt: Array<[string, (s: ReturnType<typeof summarize>) => string, "max" | "min" | null]> = [
    ["calls answered", (s) => `${s.answered}/${s.calls}`, null],
    ["schema valid", (s) => pct(s.schema), "max"],
    ["numbers grounded", (s) => pct(s.grounded), "max"],
    ["no causal claims", (s) => pct(s.noCausal), "max"],
    ["well-formed summary", (s) => pct(s.wellFormed), "max"],
    ["first-pass accepted", (s) => pct(s.accepted), "max"],
    ["high-finding coverage", (s) => pct(s.coverage), "max"],
    ...(JUDGE ? DIMENSIONS.map((d) => [`judge: ${d} (1-5)`, (s: ReturnType<typeof summarize>) => (Number.isNaN(s.judge[d]) ? "n/a" : s.judge[d].toFixed(2)), "max"] as [string, (s: ReturnType<typeof summarize>) => string, "max"]) : []),
    ...(JUDGE ? [["judge: overall (1-5)", (s: ReturnType<typeof summarize>) => (Number.isNaN(s.judgeOverall) ? "n/a" : s.judgeOverall.toFixed(2)), "max"] as [string, (s: ReturnType<typeof summarize>) => string, "max"]] : []),
    ["latency p50 (ms)", (s) => String(s.p50), "min"],
    ["latency p95 (ms)", (s) => String(s.p95), "min"],
    ["tokens in / answer", (s) => `${s.tokIn} / ${s.tokOut}`, null],
    ["thinking tokens", (s) => String(s.tokThink), "min"],
  ];
  console.log("");
  console.table(Object.fromEntries(fmt.map(([label, f]) => [label, Object.fromEntries(MODELS.map((m) => [m, f(results[m]!)]))])));

  const usable = MODELS.filter((m) => results[m]!.answered > 0);
  for (const m of MODELS) if (!usable.includes(m)) console.log(`${m}: no answers (unavailable or quota exhausted), excluded from the verdict`);
  if (usable.length > 1) {
    const by = (key: (s: ReturnType<typeof summarize>) => number, dir: 1 | -1) => [...usable].sort((a, b) => dir * (key(results[a]!) - key(results[b]!)))[0]!;
    console.log(`fastest: ${by((s) => s.p50, 1)}   fewest rejected answers: ${by((s) => s.accepted, -1)}` +
      (JUDGE && calibration && calibration.separation >= 0.8 ? `   best writing quality: ${by((s) => s.judgeOverall, -1)}` : ""));
    if (JUDGE) console.log("note: the judge is a model too; if it is one of the compared models it may favor its own style.");
  }
  const dir = path.join(__dirname, "reports");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `compare-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), calibration, models: MODELS, judgeModels: JUDGE ? JUDGE_MODELS : null, runs: RUNS, results }, null, 2));
  console.log(`Report written to ${path.relative(process.cwd(), file)}`);
}

interface Row {
  ok: boolean; ms: number; usage?: { promptTokens: number; outputTokens: number; thoughtTokens: number };
  score?: ReturnType<typeof scoreAnswer>; judge?: Awaited<ReturnType<typeof judgeAnswer>>;
}

function summarize(rows: Row[]) {
  const ok = rows.filter((r) => r.ok && r.score);
  const rate = (f: (s: NonNullable<Row["score"]>) => boolean) => (ok.length ? ok.filter((r) => f(r.score!)).length / ok.length : NaN);
  const judged = ok.filter((r) => r.judge);
  const jd = Object.fromEntries(DIMENSIONS.map((d) => [d, mean(judged.map((r) => r.judge![d]))])) as Record<(typeof DIMENSIONS)[number], number>;
  return {
    calls: rows.length, answered: ok.length,
    schema: rate((s) => s.schemaOk), grounded: rate((s) => s.unknownNumbers.length === 0), noCausal: rate((s) => s.causalClaims.length === 0),
    wellFormed: rate((s) => s.wellFormed), accepted: rate((s) => s.accepted),
    coverage: mean(ok.map((r) => r.score!.highCoverage)),
    judge: jd, judgeOverall: mean(judged.map((r) => r.judge!.overall)), judged: judged.length,
    p50: Math.round(q(ok.map((r) => r.ms), 0.5)), p95: Math.round(q(ok.map((r) => r.ms), 0.95)),
    tokIn: Math.round(mean(ok.map((r) => r.usage?.promptTokens ?? 0))), tokOut: Math.round(mean(ok.map((r) => r.usage?.outputTokens ?? 0))),
    tokThink: Math.round(mean(ok.map((r) => r.usage?.thoughtTokens ?? 0))),
  };
}

main().catch((e) => { console.error(e); process.exit(1); });
