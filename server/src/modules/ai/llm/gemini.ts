import { LlmUnavailableError, type Content, type LlmProvider, type ToolDeclaration, type Usage } from "./provider";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface GeminiResponse {
  candidates?: Array<{ content?: Content }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
}

/** Reads `retryDelay` ("21s", "0.5s") from a 429 body; null when absent. Daily quotas report hours. */
async function retryDelayMs(res: Response): Promise<number | null> {
  try {
    const body = (await res.json()) as { error?: { details?: Array<{ retryDelay?: string }> } };
    const raw = body.error?.details?.find((d) => typeof d.retryDelay === "string")?.retryDelay;
    const seconds = raw ? Number.parseFloat(raw) : Number.NaN;
    return Number.isFinite(seconds) ? Math.ceil(seconds * 1000) + 250 : null;
  } catch { return null; }
}

const usageOf = (r: GeminiResponse): Usage => ({
  promptTokens: r.usageMetadata?.promptTokenCount ?? 0,
  outputTokens: r.usageMetadata?.candidatesTokenCount ?? 0,
  thoughtTokens: r.usageMetadata?.thoughtsTokenCount ?? 0,
});

export class GeminiProvider implements LlmProvider {
  readonly name = "gemini";
  constructor(
    private readonly apiKey: string,
    private readonly models: string[],
    private readonly timeoutMs = 20_000,
    private readonly backoffMs = 700,
    private readonly budgetMs = 35_000, // total time budget across all models and attempts
    private readonly maxRetryWaitMs = 8_000, // longest pause we accept after a 429 before trying the next model
  ) {}

  /**
   * The free tier often returns 503/429. So: several models in order, 2 attempts each with a pause on
   * transient errors (429/5xx), while a 4xx (e.g. 404 "model retired") moves straight to the next model.
   * `accept` turns a raw response into a result, or null when the answer is unusable (next model).
   */
  private async run<T>(body: object, accept: (raw: GeminiResponse) => T | null) {
    const attempts: string[] = [];
    const deadline = Date.now() + this.budgetMs;
    for (const model of this.models) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        if (Date.now() >= deadline) { attempts.push("time budget exhausted"); throw new LlmUnavailableError(attempts); }
        let res: Response;
        try {
          res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
            method: "POST",
            // The key goes in a header, not in the URL (URLs end up in logs).
            headers: { "x-goog-api-key": this.apiKey, "content-type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(Math.min(this.timeoutMs, Math.max(1000, deadline - Date.now()))),
          });
        } catch (e) {
          attempts.push(`${model}: ${(e as Error).name}`);
          await sleep(this.backoffMs * attempt);
          continue;
        }
        if (res.ok) {
          const raw = (await res.json()) as GeminiResponse;
          const value = accept(raw);
          if (value !== null) return { value, model, usage: usageOf(raw) };
          attempts.push(`${model}: empty or invalid response`);
          break;
        }
        attempts.push(`${model}: HTTP ${res.status}`);
        if (res.status === 429) {
          // The API says how long to wait. A short wait (per-minute quota) is worth retrying on the same model;
          // a long one (daily quota) is not: go straight to the next model instead of burning time.
          const wait = await retryDelayMs(res);
          if (wait === null) { await sleep(this.backoffMs * attempt); continue; }
          if (wait <= this.maxRetryWaitMs && Date.now() + wait < deadline) { await sleep(wait); continue; }
          break;
        }
        if (res.status >= 500) { await sleep(this.backoffMs * attempt); continue; }
        break;
      }
    }
    throw new LlmUnavailableError(attempts);
  }

  async generate({ prompt, schema, temperature = 0.2 }: { prompt: string; schema: object; temperature?: number }) {
    const { value, model, usage } = await this.run(
      { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema, temperature } },
      (raw) => {
        const text = raw.candidates?.[0]?.content?.parts?.[0]?.text;
        try { return text ? (JSON.parse(text) as unknown) : null; } catch { return null; } // invalid JSON: failure of this model
      },
    );
    return { json: value, model, usage };
  }

  async converse({ system, contents, tools, temperature = 0.2 }: { system: string; contents: Content[]; tools: ToolDeclaration[]; temperature?: number }) {
    const { value, model, usage } = await this.run(
      {
        systemInstruction: { parts: [{ text: system }] },
        contents,
        tools: [{ functionDeclarations: tools }],
        toolConfig: { functionCallingConfig: { mode: "AUTO" } },
        generationConfig: { temperature },
      },
      // The model's turn is returned verbatim, so fields such as thought signatures survive the next call.
      (raw) => {
        const content = raw.candidates?.[0]?.content;
        return content && Array.isArray(content.parts) && content.parts.length > 0 ? content : null;
      },
    );
    return { content: value, model, usage };
  }
}
