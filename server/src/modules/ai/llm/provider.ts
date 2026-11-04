// A layer behind an interface: the rest of the app does not know which model is used.
// Swapping providers (OpenAI, Claude...) means a new class that fulfils this contract.

export interface Usage { promptTokens: number; outputTokens: number; thoughtTokens: number }

/** One piece of a conversation turn. Unknown fields (e.g. thought signatures) are passed back untouched. */
export interface Part {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  [extra: string]: unknown;
}
export interface Content { role?: "user" | "model"; parts: Part[] }

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

export interface LlmProvider {
  readonly name: string;
  /** One-shot structured generation (JSON that follows `schema`). */
  generate(req: { prompt: string; schema: object; temperature?: number }): Promise<{ json: unknown; model: string; usage?: Usage }>;
  /** One turn of a tool-using conversation; the caller runs the tools and calls again. Optional capability. */
  converse?(req: { system: string; contents: Content[]; tools: ToolDeclaration[]; temperature?: number }): Promise<{ content: Content; model: string; usage?: Usage }>;
}

export class LlmUnavailableError extends Error {
  constructor(public readonly attempts: string[]) {
    super(`LLM unavailable: ${attempts.join("; ")}`);
  }
}
