import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { Campaign } from "../../database/models";
import { notFound } from "../../shared/errors";
import { dateParam } from "../analytics/filters";
import {
  CAMPAIGN_SORT_KEYS, breakdown, getTimeseries, getTotals, listCampaigns,
} from "../analytics/analytics.repository";

export const campaignsRouter = Router();
campaignsRouter.use(requireAuth);

const range = z.object({ from: dateParam.optional(), to: dateParam.optional() })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: "'from' cannot be after 'to'", path: ["from"] });

export const campaignListSchema = range.safeExtend({
  search: z.string().trim().max(100).optional(),
  sortBy: z.enum(CAMPAIGN_SORT_KEYS).default("spend"),
  order: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

campaignsRouter.get("/", async (req, res) => {
  const { from, to, search, ...opts } = campaignListSchema.parse(req.query);
  const { items, total } = await listCampaigns(
    { workspaceId: req.auth!.workspaceId, from, to }, { search, ...opts });
  res.json({ items, total, page: opts.page, pageSize: opts.pageSize });
});

campaignsRouter.get("/:id", async (req, res) => {
  const id = z.uuid().safeParse(req.params.id);
  if (!id.success) throw notFound("Campaign not found");
  const workspaceId = req.auth!.workspaceId;
  // workspaceId in the WHERE clause: a campaign from another workspace "does not exist" for us.
  const campaign = await Campaign.findOne({ where: { id: id.data, workspaceId } });
  if (!campaign) throw notFound("Campaign not found");

  const f = { workspaceId, ...range.parse(req.query), campaignIds: [campaign.id] };
  const [totals, timeseries, adSets, ads] = await Promise.all([
    getTotals(f), getTimeseries(f), breakdown(f, "ad_set"), breakdown(f, "ad"),
  ]);
  res.json({ id: campaign.id, name: campaign.name, totals, timeseries, adSets, ads });
});
