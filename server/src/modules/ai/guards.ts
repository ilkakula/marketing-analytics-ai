import { createHash } from "node:crypto";
import { env } from "../../config/env";

// In process memory: enough for a modular monolith on a single instance.
// For multiple instances we would move to Redis (same interface).

// ---- response cache ----
interface Entry<T> { at: number; value: T }
const cache = new Map<string, Entry<unknown>>();
const MAX_ENTRIES = 200;

export const cacheKey = (parts: unknown) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");

export function cacheGet<T>(key: string): T | undefined {
  const e = cache.get(key);
  if (!e) return undefined;
  if (Date.now() - e.at > env.AI_CACHE_TTL_MINUTES * 60_000) { cache.delete(key); return undefined; }
  return e.value as T;
}
export function cacheSet<T>(key: string, value: T) {
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!); // the oldest entry is evicted
  cache.set(key, { at: Date.now(), value });
}

// ---- per-workspace call limit (protects the free quota and the cost) ----
const calls = new Map<string, number[]>();
const HOUR = 3_600_000;

export function rateLimitTake(workspaceId: string): boolean {
  const now = Date.now();
  const recent = (calls.get(workspaceId) ?? []).filter((t) => now - t < HOUR);
  if (recent.length >= env.AI_RATE_LIMIT_PER_HOUR) { calls.set(workspaceId, recent); return false; }
  calls.set(workspaceId, [...recent, now]);
  return true;
}

export function resetGuardsForTests() { cache.clear(); calls.clear(); }
