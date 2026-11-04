import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { badRequest, notFound } from "../../shared/errors";
import { MAX_PERIOD_DAYS, mappingSchema, type Period } from "./csv.adapter";
import { getImport, importCsv, listImports, undoImport } from "./imports.service";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
// Memory storage is fine with a 5 MB limit; for larger files we would switch to streaming/disk.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 1 } });

export const importsRouter = Router();
importsRouter.use(requireAuth);

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { abort: true }).refine((s) => { const d = new Date(`${s}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; });

/** Optional: only used when the file has no date column. Both or neither. */
function parsePeriod(body: Record<string, unknown> | undefined): Period | undefined {
  const from = body?.periodFrom, to = body?.periodTo;
  if (from === undefined && to === undefined) return undefined;
  const f = isoDay.safeParse(from), t = isoDay.safeParse(to);
  if (!f.success || !t.success) throw badRequest("'periodFrom' and 'periodTo' must both be dates in YYYY-MM-DD format");
  const days = (Date.parse(`${t.data}T00:00:00Z`) - Date.parse(`${f.data}T00:00:00Z`)) / 86_400_000 + 1;
  if (days < 1) throw badRequest("'periodTo' cannot be before 'periodFrom'");
  if (days > MAX_PERIOD_DAYS) throw badRequest(`The period can be at most ${MAX_PERIOD_DAYS} days`);
  return { from: f.data, to: t.data };
}

importsRouter.post("/csv", upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) throw badRequest("Missing file (multipart field 'file')");
  if (!/\.csv$/i.test(file.originalname)) throw badRequest("Only .csv files are allowed");

  let mapping;
  try {
    mapping = mappingSchema.parse(req.body?.mapping ? JSON.parse(req.body.mapping) : {});
  } catch {
    throw badRequest("The 'mapping' field must be JSON like {\"campaign\": \"Column name\", ...}");
  }

  const job = await importCsv({
    workspaceId: req.auth!.workspaceId, userId: req.auth!.userId,
    filename: file.originalname, buffer: file.buffer, mapping, period: parsePeriod(req.body),
  });
  res.status(job.status === "failed" ? 422 : 201).json(job);
});

importsRouter.get("/", async (req, res) => {
  res.json({ items: await listImports(req.auth!.workspaceId) });
});

importsRouter.delete("/:id", async (req, res) => {
  const id = z.uuid().safeParse(req.params.id);
  if (!id.success) throw notFound("Import not found");
  res.json(await undoImport(req.auth!.workspaceId, id.data));
});

importsRouter.get("/:id", async (req, res) => {
  const id = z.uuid().safeParse(req.params.id);
  if (!id.success) throw notFound("Import not found");
  res.json(await getImport(req.auth!.workspaceId, id.data));
});
