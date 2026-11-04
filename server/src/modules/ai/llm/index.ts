import { env } from "../../../config/env";
import { GeminiProvider } from "./gemini";
import type { LlmProvider } from "./provider";

let override: LlmProvider | null | undefined;
/** Tests only: inject a fake provider (or null = no LLM). */
export const setProviderForTests = (p: LlmProvider | null | undefined) => { override = p; };

export function getProvider(): LlmProvider | null {
  if (override !== undefined) return override;
  if (!env.GEMINI_API_KEY) return null; // without a key only the rules layer runs
  const models = env.GEMINI_MODELS.split(",").map((m) => m.trim()).filter(Boolean);
  return new GeminiProvider(env.GEMINI_API_KEY, models);
}
