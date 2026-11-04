import { z } from "zod";
import { CAMPAIGN_SORT_KEYS } from "../../analytics/analytics.repository";
import { dateParam, type Filters } from "../../analytics/filters";
import { METRIC_KEYS, changeMap, type MetricKey } from "../../analytics/metrics";
import { previousPeriod } from "../../analytics/filters";
import { analyzePeriod } from "../analysis";
import type { ToolDeclaration } from "../llm/provider";
import { describe } from "../templates";
import type { AnalyticsPort } from "./port";

// The ONLY things the model can do: a short list of read-only functions over the user's own data.
// - The workspace comes from the verified token (ToolContext), never from a tool argument.
// - Arguments are validated; a bad call returns an error the model can read and fix.
// - The model never writes SQL and never sees the database.

export interface ToolContext {
  port: AnalyticsPort;
  workspaceId: string;
  currency: string;
  targetRoas?: number;
  defaults: { from?: string; to?: string }; // the period selected in the UI
}

const period = { from: dateParam.optional(), to: dateParam.optional() };
const metricEnum = z.enum(METRIC_KEYS as [MetricKey, ...MetricKey[]]);

const schemas = {
  get_summary: z.object({ ...period, campaign: z.string().trim().min(1).max(120).optional(), compare_previous: z.boolean().optional() }),
  get_trend: z.object({
    ...period, campaign: z.string().trim().min(1).max(120).optional(),
    granularity: z.enum(["day", "week"]).default("week"), metrics: z.array(metricEnum).min(1).max(6).optional(),
  }),
  list_campaigns: z.object({
    ...period, sort_by: z.enum(CAMPAIGN_SORT_KEYS).default("spend"), order: z.enum(["asc", "desc"]).default("desc"),
    limit: z.number().int().min(1).max(15).default(10), search: z.string().trim().max(100).optional(),
  }),
  get_campaign_details: z.object({ name: z.string().trim().min(1).max(120), ...period }),
  get_findings: z.object({ ...period }),
};
export type ToolName = keyof typeof schemas;

const DATE = { type: "string", description: "Date as YYYY-MM-DD" };
const FROM_TO = {
  from: { ...DATE, description: "Start date (YYYY-MM-DD). Defaults to the period selected in the app." },
  to: { ...DATE, description: "End date (YYYY-MM-DD). Defaults to the period selected in the app." },
};
const METRIC_ENUM = { type: "string", enum: METRIC_KEYS };

export const TOOL_DECLARATIONS: ToolDeclaration[] = [
  { name: "get_summary", description: "Totals and derived metrics (spend, revenue, ROAS, CPC, CTR, CPA, conversions...) for a period, optionally for one campaign and compared with the previous period of the same length.",
    parameters: { type: "object", properties: { ...FROM_TO, campaign: { type: "string", description: "Campaign name (optional)" }, compare_previous: { type: "boolean", description: "Also return the previous period and percentage changes" } } } },
  { name: "get_trend", description: "How metrics evolve over time, by week (default) or by day, for the whole account or one campaign.",
    parameters: { type: "object", properties: { ...FROM_TO, campaign: { type: "string", description: "Campaign name (optional)" }, granularity: { type: "string", enum: ["day", "week"] }, metrics: { type: "array", items: METRIC_ENUM, description: "Which metrics to return (default spend, revenue, roas, conversions)" } } } },
  { name: "list_campaigns", description: "Campaigns with their metrics, sorted and limited (for questions like best, worst or biggest campaign).",
    parameters: { type: "object", properties: { ...FROM_TO, sort_by: { type: "string", enum: [...CAMPAIGN_SORT_KEYS] }, order: { type: "string", enum: ["asc", "desc"] }, limit: { type: "integer", description: "1 to 15, default 10" }, search: { type: "string", description: "Filter by name" } } } },
  { name: "get_campaign_details", description: "Metrics, ad set breakdown and weekly trend of one campaign, found by name.",
    parameters: { type: "object", properties: { name: { type: "string", description: "Campaign name (or part of it)" }, ...FROM_TO }, required: ["name"] } },
  { name: "get_findings", description: "The problems and opportunities our rules detected in the period (campaigns losing money, CPC spikes, conversion drops, anomalies...), with evidence numbers.",
    parameters: { type: "object", properties: { ...FROM_TO } } },
];

type Json = Record<string, unknown>;

function filtersFor(ctx: ToolContext, a: { from?: string; to?: string }): Filters {
  const from = a.from ?? ctx.defaults.from;
  const to = a.to ?? ctx.defaults.to;
  if (from && to && from > to) throw new ToolError("'from' cannot be after 'to'");
  return { workspaceId: ctx.workspaceId, from, to };
}

class ToolError extends Error {}

async function resolveCampaign(ctx: ToolContext, name: string) {
  const matches = await ctx.port.findCampaigns(ctx.workspaceId, name);
  const exact = matches.find((m) => m.name.toLowerCase() === name.toLowerCase());
  if (exact) return exact;
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) throw new ToolError(`No campaign matches "${name}"`);
  throw new ToolError(`"${name}" is ambiguous, matching: ${matches.map((m) => m.name).join(", ")}`);
}

const pick = (row: object, keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, (row as Record<string, unknown>)[k]]));

async function execute(name: ToolName, raw: unknown, ctx: ToolContext): Promise<Json> {
  switch (name) {
    case "get_summary": {
      const a = schemas.get_summary.parse(raw);
      const f = filtersFor(ctx, a);
      const camp = a.campaign ? await resolveCampaign(ctx, a.campaign) : undefined;
      const scoped = camp ? { ...f, campaignIds: [camp.id] } : f;
      const totals = await ctx.port.getTotals(scoped);
      const out: Json = { period: { from: f.from ?? null, to: f.to ?? null }, ...(camp ? { campaign: camp.name } : {}), totals };
      if (a.compare_previous) {
        if (!f.from || !f.to) throw new ToolError("compare_previous needs a period (from and to)");
        const prev = previousPeriod(f.from, f.to);
        const previous = await ctx.port.getTotals({ ...scoped, ...prev });
        out.previous = { period: prev, totals: previous };
        out.changePercent = changeMap(totals, previous);
      }
      return out;
    }
    case "get_trend": {
      const a = schemas.get_trend.parse(raw);
      const f = filtersFor(ctx, a);
      const camp = a.campaign ? await resolveCampaign(ctx, a.campaign) : undefined;
      const scoped = camp ? { ...f, campaignIds: [camp.id] } : f;
      const keys = a.metrics ?? (["spend", "revenue", "roas", "conversions"] as MetricKey[]);
      const rows = a.granularity === "day"
        ? (await ctx.port.getTimeseries(scoped)).map((r) => ({ date: r.date, ...pick(r, keys) }))
        : (await ctx.port.getWeekly(scoped)).map((r) => ({ week_starting: r.week, days_with_data: r.days, ...pick(r, keys) }));
      return { period: { from: f.from ?? null, to: f.to ?? null }, ...(camp ? { campaign: camp.name } : {}), granularity: a.granularity, points: rows.slice(-60) };
    }
    case "list_campaigns": {
      const a = schemas.list_campaigns.parse(raw);
      const f = filtersFor(ctx, a);
      const { items, total } = await ctx.port.listCampaigns(f, { search: a.search, sortBy: a.sort_by, order: a.order, page: 1, pageSize: a.limit });
      return { period: { from: f.from ?? null, to: f.to ?? null }, total_matching: total, campaigns: items.map(({ id: _id, ...rest }) => rest) };
    }
    case "get_campaign_details": {
      const a = schemas.get_campaign_details.parse(raw);
      const f = filtersFor(ctx, a);
      const camp = await resolveCampaign(ctx, a.name);
      const scoped = { ...f, campaignIds: [camp.id] };
      const [totals, adSets, weekly] = await Promise.all([ctx.port.getTotals(scoped), ctx.port.breakdown(scoped, "ad_set"), ctx.port.getCampaignWeekly(scoped)]);
      return {
        period: { from: f.from ?? null, to: f.to ?? null }, campaign: camp.name, totals,
        ad_sets: adSets.slice(0, 5).map(({ id: _id, ...rest }) => rest),
        weekly: weekly.filter((w) => w.id === camp.id).slice(-8).map((w) => ({ week_starting: w.week, days_with_data: w.days, ...pick(w, ["spend", "revenue", "roas", "conversions", "cpc"]) })),
      };
    }
    case "get_findings": {
      const a = schemas.get_findings.parse(raw);
      const f = filtersFor(ctx, a);
      const { findings } = await analyzePeriod(ctx.port, f, { roas: ctx.targetRoas });
      return {
        period: { from: f.from ?? null, to: f.to ?? null },
        findings: findings.map((x) => ({ id: x.id, type: x.type, severity: x.severity, campaign: x.campaignName, ...(x.date ? { date: x.date } : {}), message: describe(x, ctx.currency).message, evidence: x.evidence })),
      };
    }
  }
}

/** Runs one tool call. Never throws: problems come back as `{ error }` so the model can correct itself. */
export async function runTool(name: string, args: unknown, ctx: ToolContext): Promise<{ result: Json; ok: boolean }> {
  if (!(name in schemas)) return { result: { error: `Unknown tool "${name}"` }, ok: false };
  try {
    return { result: await execute(name as ToolName, args ?? {}, ctx), ok: true };
  } catch (e) {
    if (e instanceof z.ZodError) return { result: { error: `Invalid arguments: ${e.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ")}` }, ok: false };
    if (e instanceof ToolError) return { result: { error: e.message }, ok: false };
    throw e; // a real bug or a database failure: surface it
  }
}
