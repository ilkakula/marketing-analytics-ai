import request from "supertest";
import { createApp } from "../src/app";
import { sequelize } from "../src/database/sequelize";
import { previousPeriod } from "../src/modules/analytics/filters";
import { registerUser, resetDb } from "./helpers";

const app = createApp();
const H = "date,campaign,ad_set,ad,spend,impressions,clicks,conversions,revenue";
const CSV = [H,
  "2026-10-01,Alpha,S1,A1,100,10000,200,10,500",
  "2026-10-01,Alpha,S1,A2,50,5000,50,0,0",
  "2026-10-02,Alpha,S1,A1,100,10000,300,20,900",
  "2026-10-01,Beta,S2,B1,200,20000,100,5,200",
  "2026-10-02,Beta,S2,B1,200,20000,100,5,200",
  "2026-10-03,Gamma,S3,G1,0,1000,0,0,0",
].join("\n");

let token: string;
const get = (path: string, t = token) => request(app).get(path).set("Authorization", `Bearer ${t}`);

beforeEach(async () => {
  await resetDb();
  ({ token } = await registerUser(app, "a@x.com"));
  await request(app).post("/api/imports/csv").set("Authorization", `Bearer ${token}`)
    .attach("file", Buffer.from(CSV), "d.csv");
});
afterAll(() => sequelize.close());

describe("previousPeriod", () => {
  it("returns a period of the same length immediately before", () => {
    expect(previousPeriod("2026-10-08", "2026-10-14")).toEqual({ from: "2026-10-01", to: "2026-10-07" });
    expect(previousPeriod("2026-03-01", "2026-03-01")).toEqual({ from: "2026-02-28", to: "2026-02-28" });
  });
});

describe("GET /api/analytics/summary", () => {
  it("total metrics for the whole set", async () => {
    const { body } = await get("/api/analytics/summary");
    expect(body.totals).toMatchObject({ spend: 650, impressions: 66000, clicks: 750, conversions: 40, revenue: 1800 });
    expect(body.totals.roas).toBe(2.7692);
    expect(body.totals.ctr).toBe(1.1364); // 750 / 66000, not an average
  });

  it("filters by date", async () => {
    const { body } = await get("/api/analytics/summary?from=2026-10-02&to=2026-10-02");
    expect(body.totals.spend).toBe(300);
  });

  it("filters by campaign", async () => {
    const list = await get("/api/campaigns");
    const beta = list.body.items.find((c: { name: string }) => c.name === "Beta");
    const { body } = await get(`/api/analytics/summary?campaignIds=${beta.id}`);
    expect(body.totals.spend).toBe(400);
  });

  it("compares with the previous period", async () => {
    const { body } = await get("/api/analytics/summary?from=2026-10-02&to=2026-10-03&compare=true");
    expect(body.previous.period).toEqual({ from: "2026-09-30", to: "2026-10-01" });
    expect(body.previous.totals.spend).toBe(350); // 100+50+200 od 10-01
    expect(body.totals.spend).toBe(300);
    expect(body.change.spend).toBe(-14.29);
  });

  it("an empty period returns zeros and null metrics, not errors", async () => {
    const { body } = await get("/api/analytics/summary?from=2030-01-01&to=2030-01-31");
    expect(body.totals).toMatchObject({ spend: 0, impressions: 0, roas: null, ctr: null });
  });

  it("validates parameters", async () => {
    expect((await get("/api/analytics/summary?from=2026-10-05&to=2026-10-01")).status).toBe(400);
    expect((await get("/api/analytics/summary?from=not-a-date")).status).toBe(400);
    expect((await get("/api/analytics/summary?from=2026-02-30")).status).toBe(400);
    expect((await get("/api/analytics/summary?campaignIds=abc")).status).toBe(400);
    expect((await get("/api/analytics/summary?compare=true")).status).toBe(400);
  });

  it("requires authentication", async () => {
    expect((await request(app).get("/api/analytics/summary")).status).toBe(401);
  });
});

describe("GET /api/analytics/timeseries", () => {
  it("returns points per day with metrics computed from daily totals", async () => {
    const { body } = await get("/api/analytics/timeseries");
    expect(body.points.map((p: { date: string }) => p.date)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(body.points[0]).toMatchObject({ spend: 350, clicks: 350, ctr: 1 });
    expect(body.points[2].ctr).toBe(0); // 0 clicks / 1000 impressions
  });
});

describe("GET /api/campaigns", () => {
  it("sorts by spend descending by default, with metrics", async () => {
    const { body } = await get("/api/campaigns");
    expect(body.total).toBe(3);
    expect(body.items.map((c: { name: string }) => c.name)).toEqual(["Beta", "Alpha", "Gamma"]);
    expect(body.items[1]).toMatchObject({ name: "Alpha", spend: 250, roas: 5.6 });
  });

  it("sorts by a computed metric, null last", async () => {
    const { body } = await get("/api/campaigns?sortBy=roas&order=desc");
    expect(body.items.map((c: { name: string }) => c.name)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(body.items[2].roas).toBeNull();
    const asc = await get("/api/campaigns?sortBy=roas&order=asc");
    expect(asc.body.items.map((c: { name: string }) => c.name)).toEqual(["Beta", "Alpha", "Gamma"]); // null is still last
  });

  it("search, pagination and date filter", async () => {
    expect((await get("/api/campaigns?search=alp")).body.items).toHaveLength(1);
    expect((await get("/api/campaigns?search=%25")).body.items).toHaveLength(0); // % is a plain character, not a wildcard
    const page2 = await get("/api/campaigns?pageSize=2&page=2");
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.total).toBe(3);
    expect((await get("/api/campaigns?from=2026-10-03&to=2026-10-03")).body.items).toHaveLength(1);
  });

  it("rejects a disallowed sort (SQL injection protection)", async () => {
    expect((await get("/api/campaigns?sortBy=name;DROP TABLE users")).status).toBe(400);
  });
});

describe("GET /api/campaigns/:id", () => {
  it("returns details with the trend and a breakdown by ad set and ad", async () => {
    const list = await get("/api/campaigns");
    const alpha = list.body.items.find((c: { name: string }) => c.name === "Alpha");
    const { body } = await get(`/api/campaigns/${alpha.id}`);
    expect(body.name).toBe("Alpha");
    expect(body.totals.spend).toBe(250);
    expect(body.timeseries).toHaveLength(2);
    expect(body.adSets).toHaveLength(1);
    expect(body.ads.map((a: { name: string }) => a.name)).toEqual(["A1", "A2"]);
  });
});

describe("analytics isolation", () => {
  it("another workspace sees nothing, and another workspace's campaign is a 404", async () => {
    const other = await registerUser(app, "b@x.com", "B");
    const mine = await get("/api/campaigns");
    const summary = await get("/api/analytics/summary", other.token);
    expect(summary.body.totals.spend).toBe(0);
    expect((await get("/api/campaigns", other.token)).body.total).toBe(0);
    expect((await get(`/api/campaigns/${mine.body.items[0].id}`, other.token)).status).toBe(404);
    // even an explicit campaignIds filter does not break isolation
    const leak = await get(`/api/analytics/summary?campaignIds=${mine.body.items[0].id}`, other.token);
    expect(leak.body.totals.spend).toBe(0);
  });
});
