import { GeminiProvider } from "../src/modules/ai/llm/gemini";
import { LlmUnavailableError } from "../src/modules/ai/llm/provider";

const ok = (obj: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }), { status: 200 });
const status = (s: number) => new Response("{}", { status: s });
const urlOf = (c: unknown[]) => String(c[0]);

describe("GeminiProvider", () => {
  const fetchMock = jest.spyOn(globalThis, "fetch");
  afterEach(() => fetchMock.mockReset());
  afterAll(() => fetchMock.mockRestore());
  const provider = () => new GeminiProvider("secret-key", ["big", "small"], 1000, 1);

  it("sends the key in a header (not in the URL) and returns JSON", async () => {
    fetchMock.mockResolvedValueOnce(ok({ hello: 1 }));
    const r = await provider().generate({ prompt: "p", schema: {} });
    expect(r).toMatchObject({ json: { hello: 1 }, model: "big" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).not.toContain("secret-key");
    expect((init!.headers as Record<string, string>)["x-goog-api-key"]).toBe("secret-key");
  });

  it("reports token usage when the API returns it", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ a: 1 }) }] } }],
      usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, thoughtsTokenCount: 7 },
    }), { status: 200 }));
    const r = await provider().generate({ prompt: "p", schema: {} });
    expect(r.usage).toEqual({ promptTokens: 120, outputTokens: 30, thoughtTokens: 7 });
  });

  it("converse sends tools and the system prompt, and returns the model turn verbatim", async () => {
    const turn = { role: "model", parts: [{ functionCall: { name: "get_summary", args: { from: "2026-10-01" } }, thoughtSignature: "sig-123" }] };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: turn }] }), { status: 200 }));
    const tools = [{ name: "get_summary", description: "d", parameters: { type: "object" as const, properties: {} } }];
    const r = await provider().converse({ system: "SYS", contents: [{ role: "user", parts: [{ text: "hi" }] }], tools });
    expect(r.content).toEqual(turn); // thought signatures must survive the round trip
    const sent = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(sent.systemInstruction.parts[0].text).toBe("SYS");
    expect(sent.tools[0].functionDeclarations[0].name).toBe("get_summary");
  });

  const quota = (retryDelay: string) => new Response(JSON.stringify({ error: { code: 429, details: [{ retryDelay }] } }), { status: 429 });

  it("429 with a short retryDelay waits and retries the same model", async () => {
    fetchMock.mockResolvedValueOnce(quota("0.01s")).mockResolvedValueOnce(ok({ a: 1 }));
    const r = await provider().generate({ prompt: "p", schema: {} });
    expect(r.model).toBe("big");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("429 with a long retryDelay (daily quota) skips straight to the next model", async () => {
    fetchMock.mockResolvedValueOnce(quota("35542s")).mockResolvedValueOnce(ok({ b: 2 }));
    const r = await provider().generate({ prompt: "p", schema: {} });
    expect(r.model).toBe("small");
    expect(fetchMock).toHaveBeenCalledTimes(2); // no wasted second attempt on the exhausted model
  });

  it("retries a transient error (503) and then succeeds", async () => {
    fetchMock.mockResolvedValueOnce(status(503)).mockResolvedValueOnce(ok({ a: 1 }));
    const r = await provider().generate({ prompt: "p", schema: {} });
    expect(r.model).toBe("big");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("moves to the next model when the first keeps failing or is retired", async () => {
    fetchMock.mockResolvedValueOnce(status(404)) // big retired -> straight to the next one
      .mockResolvedValueOnce(ok({ b: 2 }));
    const r = await provider().generate({ prompt: "p", schema: {} });
    expect(r.model).toBe("small");
    expect(urlOf(fetchMock.mock.calls[1]!)).toContain("/small:");
  });

  it("throws LlmUnavailableError when every model fails", async () => {
    fetchMock.mockResolvedValue(status(503));
    await expect(provider().generate({ prompt: "p", schema: {} })).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(4); // 2 models x 2 attempts
  });

  it("respects the total time budget", async () => {
    fetchMock.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 30)); return status(503); });
    const p = new GeminiProvider("k", ["a", "b", "c"], 1000, 1, 50); // 50ms budget
    await expect(p.generate({ prompt: "p", schema: {} })).rejects.toThrow(/budget/);
    expect(fetchMock.mock.calls.length).toBeLessThan(6);
  });

  it("invalid model JSON is treated as a failure of that model", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "not json" }] } }] }), { status: 200 }))
      .mockResolvedValueOnce(ok({ c: 3 }));
    expect((await provider().generate({ prompt: "p", schema: {} })).model).toBe("small");
  });
});
