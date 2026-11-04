import request from "supertest";
import { createApp } from "../src/app";
import { sequelize } from "../src/database/sequelize";
import { sqlPort } from "../src/modules/ai/ask/port";
import { buildSystemPrompt, validateAnswer } from "../src/modules/ai/ask/ask.service";
import { TOOL_DECLARATIONS, runTool } from "../src/modules/ai/ask/tools";
import { resetGuardsForTests } from "../src/modules/ai/guards";
import { setProviderForTests } from "../src/modules/ai/llm";
import { LlmUnavailableError, type Content, type LlmProvider, type ToolDeclaration } from "../src/modules/ai/llm/provider";
import { Workspace } from "../src/database/models";
import { registerUser, resetDb } from "./helpers";

const app = createApp();
const H = "date,campaign,ad_set,ad,spend,impressions,clicks,conversions,revenue";
const CSV = [H,
  "2026-10-01,Losing Money,S,A,300,30000,300,5,150",
  "2026-10-02,Losing Money,S,A,300,30000,300,5,150",
  "2026-10-01,Good One,S,A,200,20000,400,40,800",
  "2026-10-02,Good One,S,A,200,20000,400,40,800",
].join("\n");

type Ctx = { contents: Content[]; system: string; tools: ToolDeclaration[]; call: number };
const callTool = (name: string, args: Record<string, unknown> = {}): Content => ({ role: "model", parts: [{ functionCall: { name, args } }] });
const say = (text: string): Content => ({ role: "model", parts: [{ text }] });
/** The most recent tool results the "model" has just been given. */
const lastResults = (contents: Content[]) =>
  [...contents].reverse().find((c) => c.parts.some((p) => p.functionResponse))?.parts.map((p) => p.functionResponse!.response.result as any) ?? [];

const hasResult = (contents: Content[]) => contents.some((c) => c.parts.some((p) => p.functionResponse));

function fake(script: (c: Ctx) => Content) {
  const seen: Ctx[] = [];
  const provider: LlmProvider = {
    name: "fake",
    generate: async () => { throw new Error("not used"); },
    converse: async ({ system, contents, tools }) => {
      const ctx = { system, contents: structuredClone(contents), tools, call: seen.length + 1 };
      seen.push(ctx);
      return { content: script(ctx), model: "fake-model" };
    },
  };
  return { provider, seen };
}

let token: string;
const ask = (body: object, t = token) => request(app).post("/api/ai/ask").set("Authorization", `Bearer ${t}`).send(body);
const importCsv = (t: string, csv: string) => request(app).post("/api/imports/csv").set("Authorization", `Bearer ${t}`).attach("file", Buffer.from(csv), "d.csv");

beforeAll(() => { jest.spyOn(console, "warn").mockImplementation(() => {}); }); // rejected answers are logged on purpose
beforeEach(async () => {
  await resetDb(); resetGuardsForTests(); setProviderForTests(null);
  ({ token } = await registerUser(app, "a@x.com"));
  expect((await importCsv(token, CSV)).status).toBe(201);
});
afterAll(async () => { setProviderForTests(undefined); await sequelize.close(); });

describe("POST /api/ai/ask", () => {
  it("answers through tools: the model calls a tool, then cites its numbers", async () => {
    const f = fake((c) => c.call === 1
      ? callTool("list_campaigns", { sort_by: "roas", order: "asc", limit: 1 })
      : say(`The lowest ROAS is ${lastResults(c.contents)[0].campaigns[0].roas} at ${lastResults(c.contents)[0].campaigns[0].name}.`));
    setProviderForTests(f.provider);
    const res = await ask({ question: "Which campaign has the lowest ROAS?" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ source: "llm", verified: true, model: "fake-model", cached: false });
    expect(res.body.answer).toBe("The lowest ROAS is 0.5 at Losing Money.");
    expect(res.body.steps).toEqual([{ tool: "list_campaigns", args: { sort_by: "roas", order: "asc", limit: 1 }, ok: true }]);
  });

  it("the model is given read-only tools without any workspace argument, and untrusted-data rules", async () => {
    const f = fake(() => say("I can only answer questions about your advertising data."));
    setProviderForTests(f.provider);
    await ask({ question: "What is the weather in Paris?" });
    const { system, tools } = f.seen[0]!;
    expect(system).toContain("untrusted data");
    expect(system).toContain("ONLY numbers returned by the tools");
    for (const t of tools) expect(Object.keys(t.parameters.properties).join()).not.toMatch(/workspace|user|tenant/i);
    expect(tools.map((t) => t.name).sort()).toEqual(["get_campaign_details", "get_findings", "get_summary", "get_trend", "list_campaigns"]);
  });

  it("off-topic questions get the refusal without calling any tool", async () => {
    setProviderForTests(fake(() => say("I can only answer questions about your advertising data.")).provider);
    const res = await ask({ question: "Write me a poem about cats" });
    expect(res.body).toMatchObject({ source: "llm", verified: true, steps: [] });
  });

  it("rejects an invented number, retries once with feedback, then falls back to the data", async () => {
    const f = fake((c) => c.call === 1 ? callTool("get_summary") : say("Spend was 4321 USD."));
    setProviderForTests(f.provider);
    const res = await ask({ question: "How much did we spend?" });
    expect(res.body).toMatchObject({ source: "data", verified: false, notice: "LLM_REJECTED" });
    expect(res.body.answer).toContain("could not produce an answer that passed verification");
    expect(res.body.facts[0].tool).toBe("get_summary"); // what the model looked at stays visible
    expect(JSON.stringify(f.seen.at(-1)!.contents)).toContain("Your answer was rejected");
    expect(JSON.stringify(res.body)).not.toContain("4321");
  });

  it("the corrective retry can succeed", async () => {
    let said = 0;
    const f = fake((c) => {
      if (c.call === 1) return callTool("get_summary");
      said++;
      const spend = lastResults(c.contents)[0]?.totals?.spend;
      return say(said === 1 ? "Spend was 4321 USD." : `Spend was ${spend} USD.`);
    });
    setProviderForTests(f.provider);
    const res = await ask({ question: "How much did we spend?" });
    expect(res.body).toMatchObject({ source: "llm", verified: true });
    expect(res.body.answer).toBe("Spend was 1000 USD.");
  });

  it("rejects a cause stated as fact and accepts the hedged rewrite", async () => {
    let n = 0;
    setProviderForTests(fake((c) => {
      if (c.call === 1) return callTool("get_summary");
      const roas = lastResults(c.contents)[0].totals.roas;
      return say(++n === 1 ? "ROAS was low, caused by weak creatives." : `ROAS was ${roas}, which may be linked to creative quality.`);
    }).provider);
    const res = await ask({ question: "Why is ROAS low?" });
    expect(res.body).toMatchObject({ source: "llm", verified: true });
    expect(res.body.answer).toContain("may be linked");
  });

  it("bad tool arguments come back as a readable error the model can fix", async () => {
    const f = fake((c) => {
      if (c.call === 1) return callTool("get_summary", { from: "not-a-date" });
      if (c.call === 2) return callTool("get_summary", { from: "2026-10-01", to: "2026-10-02" });
      return say(`Spend was ${lastResults(c.contents)[0].totals.spend} USD.`);
    });
    setProviderForTests(f.provider);
    const res = await ask({ question: "Spend in October?" });
    expect(f.seen[1]!.contents.at(-1)!.parts[0]!.functionResponse!.response.result).toMatchObject({ error: expect.stringContaining("Invalid arguments") });
    expect(res.body.steps.map((s: { ok: boolean }) => s.ok)).toEqual([false, true]);
    expect(res.body).toMatchObject({ source: "llm", verified: true });
  });

  it("isolation: another workspace cannot reach a campaign of this one", async () => {
    const other = await registerUser(app, "b@x.com", "B");
    await importCsv(other.token, `${H}\n2026-10-01,Other Company Campaign,S,A,100,1000,10,1,50`);
    const f = fake((c) => c.call === 1 ? callTool("get_campaign_details", { name: "Losing Money" }) : say("I could not find that campaign."));
    setProviderForTests(f.provider);
    const res = await ask({ question: "Tell me about Losing Money" }, other.token);
    expect(f.seen[1]!.contents.at(-1)!.parts[0]!.functionResponse!.response.result).toMatchObject({ error: expect.stringContaining("No campaign matches") });
    expect(JSON.stringify(f.seen)).not.toContain("300"); // no numbers of the other workspace leaked into the conversation
    expect(res.body.steps[0].ok).toBe(false);
  });

  it("a model that never stops calling tools is cut off and the user still gets the data", async () => {
    const f = fake(() => callTool("get_summary"));
    setProviderForTests(f.provider);
    const res = await ask({ question: "Keep going forever" });
    expect(res.body).toMatchObject({ source: "data", notice: "LLM_REJECTED" });
    expect(res.body.steps.length).toBeLessThanOrEqual(8);
  });

  it("caches identical questions, and a new import invalidates the cache", async () => {
    // Keyed on the conversation (not on a global call counter): every question starts a new conversation.
    const f = fake((c) => !hasResult(c.contents) ? callTool("get_summary") : say(`Spend was ${lastResults(c.contents)[0].totals.spend} USD.`));
    setProviderForTests(f.provider);
    const first = await ask({ question: "How much did we spend?" });
    const second = await ask({ question: "  how much did we SPEND? " });
    expect(first.body.cached).toBe(false);
    expect(second.body.cached).toBe(true);
    expect(f.seen).toHaveLength(2); // the second question did not reach the model
    await importCsv(token, `${H}\n2026-10-03,Another,S,A,50,5000,50,1,40`);
    expect((await ask({ question: "How much did we spend?" })).body.cached).toBe(false);
  });

  it("without a model it falls back to the rule-based summary", async () => {
    const res = await ask({ question: "How are we doing?" });
    expect(res.body).toMatchObject({ source: "data", verified: false, notice: "NO_API_KEY" });
    expect(res.body.answer).toContain("In the selected period");
  });

  it("an empty workspace is told to import data first, without calling the model", async () => {
    const empty = await registerUser(app, "c@x.com", "C");
    const f = fake(() => say("x"));
    setProviderForTests(f.provider);
    const res = await ask({ question: "How are we doing?" }, empty.token);
    expect(res.body).toMatchObject({ notice: "NO_DATA", source: "data" });
    expect(f.seen).toHaveLength(0);
  });

  it("an unavailable model degrades to the data summary", async () => {
    setProviderForTests({ name: "down", generate: async () => { throw new Error("x"); }, converse: async () => { throw new LlmUnavailableError(["503"]); } });
    expect((await ask({ question: "How are we doing?" })).body).toMatchObject({ source: "data", notice: "LLM_UNAVAILABLE" });
  });

  it("requires authentication and validates the request", async () => {
    expect((await request(app).post("/api/ai/ask").send({ question: "hello there" })).status).toBe(401);
    expect((await ask({ question: "hi" })).status).toBe(400);
    expect((await ask({ question: "x".repeat(501) })).status).toBe(400);
    expect((await ask({ question: "valid question", from: "bad" })).status).toBe(400);
    expect((await ask({})).status).toBe(400);
  });
});

describe("tools", () => {
  const ctx = async (defaults: { from?: string; to?: string } = {}) => {
    const ws = await Workspace.findOne();
    return { port: sqlPort, workspaceId: ws!.id, currency: "USD", defaults };
  };

  it("get_summary compares with the previous period and returns provided percentage changes", async () => {
    const { result, ok } = await runTool("get_summary", { from: "2026-10-02", to: "2026-10-02", compare_previous: true }, await ctx());
    expect(ok).toBe(true);
    expect(result).toMatchObject({ period: { from: "2026-10-02", to: "2026-10-02" }, previous: { period: { from: "2026-10-01", to: "2026-10-01" } } });
    expect((result as any).changePercent.spend).toBe(0);
  });

  it("uses the period selected in the app by default", async () => {
    const { result } = await runTool("get_summary", {}, await ctx({ from: "2026-10-01", to: "2026-10-01" }));
    expect((result as any).totals.spend).toBe(500);
  });

  it("get_findings returns the rule-based findings with evidence", async () => {
    const { result } = await runTool("get_findings", {}, await ctx());
    expect((result as any).findings[0]).toMatchObject({ type: "LOSING_MONEY", campaign: "Losing Money", severity: "high" });
  });

  it("get_trend returns weekly or daily points for selected metrics only", async () => {
    const daily = (await runTool("get_trend", { granularity: "day", metrics: ["spend"] }, await ctx())).result as any;
    expect(daily.points).toEqual([{ date: "2026-10-01", spend: 500 }, { date: "2026-10-02", spend: 500 }]);
    const weekly = (await runTool("get_trend", {}, await ctx())).result as any;
    expect(weekly.points[0]).toMatchObject({ week_starting: "2026-09-28", days_with_data: 2 });
  });

  it("get_campaign_details finds a campaign by part of its name and reports ambiguity", async () => {
    expect(((await runTool("get_campaign_details", { name: "losing" }, await ctx())).result as any).campaign).toBe("Losing Money");
    await importCsv(token, `${H}\n2026-10-01,Good Two,S,A,10,1000,10,1,20`);
    const amb = await runTool("get_campaign_details", { name: "good" }, await ctx());
    expect(amb.ok).toBe(false);
    expect((amb.result as any).error).toContain("ambiguous");
  });

  it("enforces argument limits and rejects unknown tools", async () => {
    expect((await runTool("list_campaigns", { limit: 99 }, await ctx())).ok).toBe(false);
    expect((await runTool("list_campaigns", { sort_by: "name; DROP TABLE users" }, await ctx())).ok).toBe(false);
    expect((await runTool("get_summary", { from: "2026-10-05", to: "2026-10-01" }, await ctx())).ok).toBe(false);
    expect((await runTool("delete_everything", {}, await ctx())).ok).toBe(false);
    expect(TOOL_DECLARATIONS.every((t) => t.name !== "delete_everything")).toBe(true);
  });
});

describe("validateAnswer and the system prompt", () => {
  const facts = [{ tool: "get_summary", result: { totals: { spend: 1000, roas: 1.8 }, campaign: "Alpha 2" } }];
  it("accepts cited numbers, campaign names with digits and numbers from the question", () => {
    expect(validateAnswer("Alpha 2 spent 1000 and ROAS was 1.8.", facts, "how was Alpha 2?")).toEqual([]);
    expect(validateAnswer("Over the last 14 days, spend was 1000.", facts, "what happened in the last 14 days?")).toEqual([]);
  });
  it("rejects invented numbers, causes as fact and empty or oversized answers", () => {
    expect(validateAnswer("Spend was 1234.", facts, "q").join()).toContain("1234");
    expect(validateAnswer("ROAS fell because of the weak creative, caused by the new ad.", facts, "q").join()).toContain("Causal");
    expect(validateAnswer("   ", facts, "q")).toHaveLength(1);
    expect(validateAnswer("word ".repeat(400), facts, "q").join()).toContain("too long");
  });
  it("tells the model today's date, the data range and the selected period", () => {
    const p = buildSystemPrompt({ today: "2026-11-03", dataFrom: "2026-09-07", dataTo: "2026-11-03", from: "2026-10-05", to: "2026-11-03", currency: "USD" });
    expect(p).toContain("today is 2026-11-03");
    expect(p).toContain("2026-09-07 to 2026-11-03");
    expect(p).toContain("2026-10-05 to 2026-11-03");
  });
});
