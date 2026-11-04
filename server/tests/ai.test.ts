import request from "supertest";
import { createApp } from "../src/app";
import { sequelize } from "../src/database/sequelize";
import { setProviderForTests } from "../src/modules/ai/llm";
import type { LlmProvider } from "../src/modules/ai/llm/provider";
import { rateLimitTake, resetGuardsForTests } from "../src/modules/ai/guards";
import { env } from "../src/config/env";
import { registerUser, resetDb } from "./helpers";

const app = createApp();
const H = "date,campaign,ad_set,ad,spend,impressions,clicks,conversions,revenue";
// Losing Money: 2 dana, spend 600, revenue 300 (ROAS 0.5); Good: spend 400, revenue 1600 (ROAS 4)
const CSV = [H,
  "2026-10-01,Losing Money,S,A,300,30000,300,5,150",
  "2026-10-02,Losing Money,S,A,300,30000,300,5,150",
  "2026-10-01,Good One,S,A,200,20000,400,40,800",
  "2026-10-02,Good One,S,A,200,20000,400,40,800",
].join("\n");

let token: string;
const insights = (body: object = {}, t = token) => request(app).post("/api/ai/insights").set("Authorization", `Bearer ${t}`).send(body);

function fakeProvider(respond: (prompt: string) => unknown): LlmProvider & { prompts: string[] } {
  const prompts: string[] = [];
  return { name: "fake", prompts, generate: async ({ prompt }) => { prompts.push(prompt); return { json: respond(prompt), model: "fake-model" }; } };
}
const VALID = { summary: "Campaign Losing Money has a ROAS of 0.5.", observations: ["Spend 600 USD, revenue 300 USD."],
  recommendations: [{ action: "Review campaign Losing Money", reason: "ROAS 0.5 is below 1.", basedOn: ["F1"] }] };

beforeEach(async () => {
  await resetDb(); resetGuardsForTests(); setProviderForTests(null);
  ({ token } = await registerUser(app, "a@x.com"));
  await request(app).post("/api/imports/csv").set("Authorization", `Bearer ${token}`).attach("file", Buffer.from(CSV), "d.csv");
});
afterAll(async () => { setProviderForTests(undefined); await sequelize.close(); });

describe("POST /api/ai/insights", () => {
  it("without an LLM returns deterministic findings (source=rules) and explanations with evidence", async () => {
    const res = await insights();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ source: "rules", notice: "NO_API_KEY", cached: false });
    expect(res.body.findings[0]).toMatchObject({ id: "F1", type: "LOSING_MONEY", campaignName: "Losing Money" });
    expect(res.body.findings[0].evidence).toMatchObject({ roas: 0.5, spend: 600, revenue: 300 });
    expect(res.body.insights.recommendations[0].basedOn).toEqual(["F1"]);
  });

  it("with a valid model answer returns source=llm and caches the result", async () => {
    const p = fakeProvider(() => VALID);
    setProviderForTests(p);
    const first = await insights();
    expect(first.body).toMatchObject({ source: "llm", model: "fake-model", cached: false });
    expect(first.body.insights.summary).toBe(VALID.summary);
    const second = await insights();
    expect(second.body.cached).toBe(true);
    expect(p.prompts).toHaveLength(1); // the second call did not spend quota
  });

  it("rejects an answer with an invented number and falls back to the rules", async () => {
    const p = fakeProvider(() => ({ ...VALID, summary: "The campaign lost 9999 USD." }));
    setProviderForTests(p);
    const res = await insights();
    expect(res.body).toMatchObject({ source: "rules", notice: "LLM_REJECTED" });
    expect(p.prompts).toHaveLength(2); // one corrective attempt
    expect(p.prompts[1]).toContain("REJECTED");
    expect(JSON.stringify(res.body.insights)).not.toContain("9999");
  });

  it("the corrective attempt can succeed", async () => {
    let n = 0;
    setProviderForTests(fakeProvider(() => (++n === 1 ? { ...VALID, summary: "Lost 9999 USD." } : VALID)));
    expect((await insights()).body.source).toBe("llm");
  });

  it("when the LLM is unavailable, the user still gets the rule-based findings", async () => {
    setProviderForTests({ name: "down", generate: async () => { throw new Error("network"); } });
    const res = await insights();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ source: "rules", notice: "LLM_UNAVAILABLE" });
    expect(res.body.findings.length).toBeGreaterThan(0);
  });

  it("limits the number of calls per workspace; one workspace's quota does not affect another", async () => {
    const p = fakeProvider(() => VALID);
    setProviderForTests(p);
    const ws = (await request(app).get("/api/workspaces/current").set("Authorization", `Bearer ${token}`)).body.id;
    for (let i = 0; i < env.AI_RATE_LIMIT_PER_HOUR; i++) expect(rateLimitTake(ws)).toBe(true);
    expect(rateLimitTake(ws)).toBe(false);
    expect(rateLimitTake("some-other-workspace")).toBe(true);
    const res = await insights();
    expect(res.body).toMatchObject({ source: "rules", notice: "RATE_LIMITED" });
    expect(p.prompts).toHaveLength(0); // the model was not called
  });

  it("the model receives only aggregates without raw rows, and the prompt defends against prompt injection", async () => {
    const p = fakeProvider(() => VALID);
    setProviderForTests(p);
    await insights();
    const prompt = p.prompts[0]!;
    expect(prompt).toContain("untrusted data");
    expect(prompt).toContain("Losing Money");
    expect(prompt).not.toContain('"date"');       // no daily rows
    expect(prompt).not.toContain("a@x.com");      // no user data
  });

  it("isolation: another workspace's context never enters the prompt", async () => {
    const other = await registerUser(app, "b@x.com", "B");
    await request(app).post("/api/imports/csv").set("Authorization", `Bearer ${other.token}`)
      .attach("file", Buffer.from(`${H}\n2026-10-01,Secret Campaign B,S,A,100,1000,10,1,50`), "b.csv");
    const p = fakeProvider(() => VALID);
    setProviderForTests(p);
    await insights();
    expect(p.prompts[0]).not.toContain("Secret Campaign B");
    expect((await insights({}, other.token)).body.findings.map((f: { campaignName: string }) => f.campaignName)).not.toContain("Losing Money");
  });

  it("empty workspace: NO_DATA without calling the model", async () => {
    const empty = await registerUser(app, "c@x.com", "C");
    const p = fakeProvider(() => VALID);
    setProviderForTests(p);
    const res = await insights({}, empty.token);
    expect(res.body).toMatchObject({ source: "rules", notice: "NO_DATA", findings: [] });
    expect(p.prompts).toHaveLength(0);
  });

  it("uses the workspace's target ROAS: profitable campaigns under it are flagged and the model knows the target", async () => {
    const p = fakeProvider(() => VALID);
    setProviderForTests(p);
    await request(app).patch("/api/workspaces/current").set("Authorization", `Bearer ${token}`).send({ targetRoas: 5 });
    const res = await insights();
    expect(res.body.findings.map((f: { type: string; campaignName: string }) => `${f.type}:${f.campaignName}`)).toEqual(expect.arrayContaining(["LOSING_MONEY:Losing Money", "BELOW_TARGET_ROAS:Good One"]));
    expect(p.prompts[0]).toContain('"targetRoas":5');
  });

  it("validates input and requires authentication", async () => {
    expect((await insights({ from: "bad" })).status).toBe(400);
    expect((await insights({ from: "2026-10-05", to: "2026-10-01" })).status).toBe(400);
    expect((await request(app).post("/api/ai/insights")).status).toBe(401);
  });
});
