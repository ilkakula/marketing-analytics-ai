import express from "express";
import helmet from "helmet";
import cors from "cors";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import swaggerUi from "swagger-ui-express";
import { openapi } from "./docs/openapi";
import { createAuthRouter } from "./modules/auth/auth.routes";
import type { AuthLimits } from "./middleware/rateLimit";
import { workspacesRouter } from "./modules/workspaces/workspaces.routes";
import { importsRouter } from "./modules/imports/imports.routes";
import { analyticsRouter } from "./modules/analytics/analytics.routes";
import { campaignsRouter } from "./modules/campaigns/campaigns.routes";
import { exportsRouter } from "./modules/exports/exports.routes";
import { aiRouter } from "./modules/ai/ai.routes";
import { healthRouter } from "./modules/health/health.routes";

// App factory: returns the Express app WITHOUT calling listen().
// This lets Supertest exercise the app in memory without binding a port.
export interface AppOptions { authLimits?: AuthLimits; trustProxyHops?: number }

export function createApp(opts: AppOptions = {}) {
  const app = express();
  // Limits are effectively disabled in tests (hundreds of registrations from the same IP).
  const authLimits = opts.authLimits ?? (env.NODE_ENV === "test"
    ? { loginLimit: 1_000_000, ipLimit: 1_000_000 }
    : { loginLimit: env.AUTH_LOGIN_LIMIT, ipLimit: env.AUTH_IP_LIMIT });
  app.set("trust proxy", opts.trustProxyHops ?? env.TRUST_PROXY_HOPS);

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json({ limit: "1mb" }));

  app.use("/api/health", healthRouter);
  app.use("/api/auth", createAuthRouter(authLimits));
  app.use("/api/workspaces", workspacesRouter);
  app.use("/api/imports", importsRouter);
  app.use("/api/analytics", analyticsRouter);
  app.use("/api/campaigns", campaignsRouter);
  app.use("/api/exports", exportsRouter);
  app.use("/api/ai", aiRouter);
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openapi));

  // Order matters: 404 handler first, then the error handler last.
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
