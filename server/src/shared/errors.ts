// Errors we expect (bad input, no access...) carry an HTTP status.
// Everything else is a bug and ends up as a generic 500.
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (msg = "Resource not found") => new AppError(404, "NOT_FOUND", msg);
export const badRequest = (msg: string, details?: unknown) =>
  new AppError(400, "BAD_REQUEST", msg, details);
export const unauthorized = (msg = "Unauthorized") =>
  new AppError(401, "UNAUTHORIZED", msg);
export const forbidden = (msg = "Forbidden") => new AppError(403, "FORBIDDEN", msg);
