import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

// .env lives in the monorepo root, not in server/ (npm workspaces run scripts from server/).
dotenv.config({ path: path.resolve(__dirname, "../../../.env"), quiet: true });

// Validate env at startup: the app fails immediately with a clear message
// instead of crashing later at a random spot because of an undefined value.
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4750),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: z.string().default("1h"),
  // AI analyst: without a key only the rules layer runs (same screen, no LLM).
  GEMINI_API_KEY: z.string().optional().transform((v) => v?.trim() || undefined),
  // Model chain: the first one that answers wins. Lite is ~5x faster (bigger models "think"), and is
  // enough for rephrasing already computed findings; the bigger model is the fallback.
  GEMINI_MODELS: z.string().default("gemini-3.5-flash-lite,gemini-3.8-flash"),
  AI_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(20),
  AI_CACHE_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  // Attempt limits on /api/auth (per 15 min). Login: per IP+email pair, failed attempts only.
  AUTH_LOGIN_LIMIT: z.coerce.number().int().positive().default(5),
  AUTH_IP_LIMIT: z.coerce.number().int().positive().default(30),
  // How many reverse proxies sit in front of the server (nginx = 1). Without this every user
  // would share nginx's IP and one attacker could lock everyone out; and if the server is exposed
  // directly, trusting X-Forwarded-For would let clients spoof their IP. Hence the default of 0.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
