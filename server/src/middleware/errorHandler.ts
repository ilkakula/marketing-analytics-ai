import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { MulterError } from "multer";
import { AppError, notFound } from "../shared/errors";
import { env } from "../config/env";

export const notFoundHandler: RequestHandler = (_req, _res, next) => next(notFound("Route not found"));

// One error format for the whole API: { error: { code, message, details? } }
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Invalid data", details: err.issues },
    });
    return;
  }
  if (err instanceof MulterError) {
    const tooBig = err.code === "LIMIT_FILE_SIZE";
    res.status(tooBig ? 413 : 400).json({
      error: { code: tooBig ? "FILE_TOO_LARGE" : "UPLOAD_ERROR", message: tooBig ? "File is too large (max 5 MB)" : err.message },
    });
    return;
  }
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }
  if (env.NODE_ENV !== "test") console.error(err);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
};
