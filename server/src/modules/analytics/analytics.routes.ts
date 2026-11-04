import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { badRequest } from "../../shared/errors";
import { changeMap } from "./metrics";
import { filterSchema, previousPeriod } from "./filters";
import { getTimeseries, getTotals } from "./analytics.repository";

export const analyticsRouter = Router();
analyticsRouter.use(requireAuth);

// workspaceId comes ONLY from req.auth (the verified token), never from the query string.
analyticsRouter.get("/summary", async (req, res) => {
  const { compare, ...q } = filterSchema.extend({ compare: z.enum(["true", "false"]).optional() }).parse(req.query);
  const filters = { workspaceId: req.auth!.workspaceId, ...q };
  const totals = await getTotals(filters);
  const body: Record<string, unknown> = { period: { from: q.from ?? null, to: q.to ?? null }, totals };

  if (compare === "true") {
    if (!q.from || !q.to) throw badRequest("'from' and 'to' are required for comparison");
    const prev = previousPeriod(q.from, q.to);
    const previous = await getTotals({ ...filters, ...prev });
    body.previous = { period: prev, totals: previous };
    body.change = changeMap(totals, previous);
  }
  res.json(body);
});

analyticsRouter.get("/timeseries", async (req, res) => {
  const q = filterSchema.parse(req.query);
  res.json({ points: await getTimeseries({ workspaceId: req.auth!.workspaceId, ...q }) });
});
