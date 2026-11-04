import { Workspace } from "../../database/models";
import type { Filters } from "../analytics/filters";
import { analyzePeriod } from "./analysis";
import { sqlPort } from "./ask/port";
import { buildContext } from "./context";
import { cacheGet, cacheKey, cacheSet, rateLimitTake } from "./guards";
import { getProvider } from "./llm";
import { LlmUnavailableError } from "./llm/provider";
import { buildPrompt } from "./prompt";
import { describe, rulesInsights } from "./templates";
import { insightsJsonSchema, validateInsights, type Insights } from "./validate";

export type InsightsSource = "llm" | "rules";
export type Notice = "NO_API_KEY" | "RATE_LIMITED" | "LLM_UNAVAILABLE" | "LLM_REJECTED" | "NO_DATA";

export interface InsightsResult {
  source: InsightsSource;
  model?: string;
  cached: boolean;
  generatedAt: string;
  period: { from: string | null; to: string | null };
  notice?: Notice;
  findings: Array<{ id: string; type: string; severity: string; campaignId: string; campaignName: string; date?: string; message: string; evidence: Record<string, number> }>;
  insights: Insights;
}

export async function generateInsights(
  filters: Filters, log: (msg: string) => void = console.warn,
): Promise<InsightsResult> {
  const { workspaceId, from, to } = filters;
  const ws = await Workspace.findByPk(workspaceId);
  const currency = ws?.currency ?? "USD";
  const { totals, previousTotals, change, campaigns, findings } = await analyzePeriod(sqlPort, filters);
  const ctx = buildContext({ from, to, currency, totals, previousTotals, campaigns: campaigns, findings, change });

  const base = {
    generatedAt: new Date().toISOString(), period: { from: from ?? null, to: to ?? null },
    findings: findings.map((f) => ({
      id: f.id, type: f.type, severity: f.severity, campaignId: f.campaignId, campaignName: f.campaignName, ...(f.date ? { date: f.date } : {}),
      message: describe(f, currency).message, evidence: f.evidence,
    })),
  };
  const rules = (notice?: Notice): InsightsResult => ({
    ...base, source: "rules", cached: false, ...(notice ? { notice } : {}),
    insights: rulesInsights(findings, totals, currency),
  });

  if (totals.spend === 0 && totals.impressions === 0) return rules("NO_DATA");

  const provider = getProvider();
  if (!provider) return rules("NO_API_KEY");

  const key = cacheKey({ workspaceId, provider: provider.name, ctx });
  const hit = cacheGet<InsightsResult>(key);
  if (hit) return { ...hit, cached: true };

  if (!rateLimitTake(workspaceId)) return rules("RATE_LIMITED");

  let feedback: string[] | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { json, model } = await provider.generate({ prompt: buildPrompt(ctx, feedback), schema: insightsJsonSchema });
      const verdict = validateInsights(json, ctx);
      if (verdict.ok) {
        const result: InsightsResult = { ...base, source: "llm", model, cached: false, insights: verdict.insights };
        cacheSet(key, result);
        return result;
      }
      feedback = verdict.problems; // one corrective attempt with feedback
      log(`AI answer rejected (attempt ${attempt}): ${verdict.problems.join(" | ")}`);
    } catch (e) {
      log(`AI unavailable: ${e instanceof LlmUnavailableError ? e.message : (e as Error).name}`);
      return rules("LLM_UNAVAILABLE");
    }
  }
  return rules("LLM_REJECTED");
}
