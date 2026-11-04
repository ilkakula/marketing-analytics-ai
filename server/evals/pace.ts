import type { LlmProvider } from "../src/modules/ai/llm/provider";

// The free tier allows 15 requests per minute per model. The evaluation must not trip that limit
// (it would measure the quota, not the model), so every call goes through a sliding-window pacer.
export function paced(provider: LlmProvider, perMinute = 12): LlmProvider {
  const stamps: number[] = [];
  const wait = async () => {
    for (;;) {
      const now = Date.now();
      while (stamps.length && now - stamps[0]! > 60_000) stamps.shift();
      if (stamps.length < perMinute) { stamps.push(now); return; }
      await new Promise((r) => setTimeout(r, 60_000 - (now - stamps[0]!) + 50));
    }
  };
  return {
    name: provider.name,
    generate: async (req) => { await wait(); return provider.generate(req); },
    ...(provider.converse ? { converse: async (req: Parameters<NonNullable<LlmProvider["converse"]>>[0]) => { await wait(); return provider.converse!(req); } } : {}),
  };
}
