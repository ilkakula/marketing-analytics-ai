import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { Workspace } from "../../database/models";
import { notFound } from "../../shared/errors";

export const workspacesRouter = Router();

workspacesRouter.get("/current", requireAuth, async (req, res) => {
  const ws = await Workspace.findByPk(req.auth!.workspaceId);
  if (!ws) throw notFound("Workspace not found");
  res.json({ id: ws.id, name: ws.name, currency: ws.currency, timezone: ws.timezone });
});
