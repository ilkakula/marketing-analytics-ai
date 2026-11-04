import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { AppError } from "../shared/errors";

export interface AuthLimits { loginLimit: number; ipLimit: number }
const WINDOW_MS = 15 * 60_000;

// Attempts are counted in process memory (enough for a single instance); for multiple
// instances the same middleware gets a Redis store, with no route changes.
const exceeded = (_req: unknown, _res: unknown, next: (e: unknown) => void) =>
  next(new AppError(429, "RATE_LIMITED", "Too many attempts. Please try again in a few minutes."));

export function authLimiters({ loginLimit, ipLimit }: AuthLimits) {
  const common = { windowMs: WINDOW_MS, standardHeaders: "draft-7", legacyHeaders: false, handler: exceeded } as const;
  return {
    // Total per IP address: slows down an attacker who rotates emails (credential stuffing).
    perIp: rateLimit({ ...common, limit: ipLimit, keyGenerator: (req) => ipKeyGenerator(req.ip ?? "") }),
    // Per IP+email pair, FAILED attempts only: protects one account from password guessing,
    // while a legitimate user who logs in regularly is never limited.
    login: rateLimit({
      ...common, limit: loginLimit, skipSuccessfulRequests: true,
      keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? "")}|${String(req.body?.email ?? "").trim().toLowerCase()}`,
    }),
  };
}
