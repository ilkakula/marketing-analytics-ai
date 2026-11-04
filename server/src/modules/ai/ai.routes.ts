import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { z } from "zod";
import { Workspace } from "../../database/models";
import { dateParam, filterSchema } from "../analytics/filters";
import { askQuestion } from "./ask/ask.service";
import { sqlPort } from "./ask/port";
import { getProvider } from "./llm";
import { generateInsights } from "./insights.service";

export const aiRouter = Router();
aiRouter.use(requireAuth);

// campaignIds is a comma-separated string in filterSchema (as in the query string); the body accepts the same shape.
const bodySchema = filterSchema;
aiRouter.post("/insights", async (req, res) => {
  const f = bodySchema.parse(req.body ?? {});
  res.json(await generateInsights({ workspaceId: req.auth!.workspaceId, ...f }));
});

const askSchema = z.object({
  question: z.string().trim().min(3, "Ask a longer question").max(500, "Keep the question under 500 characters"),
  from: dateParam.optional(),
  to: dateParam.optional(),
}).refine((q) => !q.from || !q.to || q.from <= q.to, { message: "'from' cannot be after 'to'", path: ["from"] });

// "Ask your data": the model may only call whitelisted read-only tools scoped to the caller's workspace.
aiRouter.post("/ask", async (req, res) => {
  const input = askSchema.parse(req.body ?? {});
  const workspaceId = req.auth!.workspaceId;
  const ws = await Workspace.findByPk(workspaceId);
  res.json(await askQuestion({ port: sqlPort, provider: getProvider() }, { workspaceId, currency: ws?.currency ?? "USD", ...input }));
});
