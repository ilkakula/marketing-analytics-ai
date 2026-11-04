import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { badRequest, notFound } from "../../shared/errors";
import { mappingSchema } from "./csv.adapter";
import { getImport, importCsv, listImports, undoImport } from "./imports.service";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
// Memory storage is fine with a 5 MB limit; for larger files we would switch to streaming/disk.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 1 } });

export const importsRouter = Router();
importsRouter.use(requireAuth);

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
    filename: file.originalname, buffer: file.buffer, mapping,
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
