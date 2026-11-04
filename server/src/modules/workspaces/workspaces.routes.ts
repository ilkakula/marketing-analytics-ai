import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { Workspace } from "../../database/models";
import { notFound } from "../../shared/errors";

export const workspacesRouter = Router();

const CURRENCIES = new Set(Intl.supportedValuesOf("currency"));

// Only what the user can sensibly change (name, display currency, the ROAS they are aiming for). Timezone is intentionally not editable yet: dates are stored
// as plain days and nothing would use it, so an editable field would promise something we do not do.
const updateSchema = z.object({
  name: z.string().trim().min(1, "Workspace name is required").max(120).optional(),
  currency: z.string().trim().toUpperCase().refine((c) => CURRENCIES.has(c), "Unknown currency code").optional(),
  // 1 = break-even. Campaigns between break-even and this value are flagged as below target.
  targetRoas: z.number().min(1, "Target ROAS cannot be below 1 (break-even)").max(100).optional(),
}).refine((v) => v.name !== undefined || v.currency !== undefined || v.targetRoas !== undefined, { message: "Nothing to update" });

const view = (ws: Workspace) => ({ id: ws.id, name: ws.name, currency: ws.currency, timezone: ws.timezone, targetRoas: Number(ws.targetRoas) });

workspacesRouter.get("/current", requireAuth, async (req, res) => {
  const ws = await Workspace.findByPk(req.auth!.workspaceId);
  if (!ws) throw notFound("Workspace not found");
  res.json(view(ws));
});

// The workspace comes from the verified token, never from the URL or the body.
workspacesRouter.patch("/current", requireAuth, async (req, res) => {
  const input = updateSchema.parse(req.body ?? {});
  const ws = await Workspace.findByPk(req.auth!.workspaceId);
  if (!ws) throw notFound("Workspace not found");
  await ws.update(input);
  res.json(view(ws));
});
