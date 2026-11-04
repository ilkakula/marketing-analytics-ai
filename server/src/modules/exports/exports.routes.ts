import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { getTimeseries, listCampaigns } from "../analytics/analytics.repository";
import { campaignListSchema } from "../campaigns/campaigns.routes";
import { toCsv } from "./csv";
import type { Metrics } from "../analytics/metrics";

export const exportsRouter = Router();
exportsRouter.use(requireAuth);

const METRIC_COLUMNS: Array<keyof Metrics> = [
  "spend", "impressions", "clicks", "ctr", "cpc", "cpm", "conversions", "cvr", "cpa", "revenue", "roas",
];
const MAX_EXPORT_ROWS = 10_000;

// page/pageSize are accepted but ignored (the export is always the full set; zod 4 does not allow omit() together with refine).
const schema = campaignListSchema.safeExtend({ level: z.enum(["campaign", "daily"]).default("campaign") });

// Exports EXACTLY what the user sees on screen (same filters, search and sorting), but without pagination.
exportsRouter.get("/csv", async (req, res) => {
  const { level, from, to, search, sortBy, order } = schema.parse(req.query);
  const workspaceId = req.auth!.workspaceId;
  const filters = { workspaceId, from, to };

  let body: string;
  if (level === "daily") {
    const points = await getTimeseries(filters);
    body = toCsv(["date", ...METRIC_COLUMNS], points.map((p) => [p.date, ...METRIC_COLUMNS.map((k) => p[k])]));
  } else {
    const { items } = await listCampaigns(filters, { search, sortBy, order, page: 1, pageSize: MAX_EXPORT_ROWS });
    body = toCsv(["campaign", ...METRIC_COLUMNS], items.map((c) => [c.name, ...METRIC_COLUMNS.map((k) => c[k])]));
  }

  const range = from || to ? `_${from ?? "start"}_${to ?? "end"}` : "";
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="spendlens-${level}${range}.csv"`);
  res.send(body);
});
