import request from "supertest";
import { createApp } from "../src/app";
import { sequelize } from "../src/database/sequelize";
import { csvCell } from "../src/modules/exports/csv";
import { registerUser, resetDb } from "./helpers";

const app = createApp();
const H = "date,campaign,ad_set,ad,spend,impressions,clicks,conversions,revenue";
const CSV = [H,
  "2026-10-01,Alpha,S,A,100,10000,200,10,500",
  "2026-10-02,Alpha,S,A,100,10000,300,20,900",
  '2026-10-01,"=HYPERLINK(""http://evil"")",S,A,50,5000,50,0,0',
  '2026-10-01,"Beta, Inc",S,A,200,20000,100,5,200',
].join("\n");

let token: string;
const get = (path: string, t = token) => request(app).get(path).set("Authorization", `Bearer ${t}`);

beforeEach(async () => {
  await resetDb();
  ({ token } = await registerUser(app, "a@x.com"));
  const imp = await request(app).post("/api/imports/csv").set("Authorization", `Bearer ${token}`).attach("file", Buffer.from(CSV), "d.csv");
  expect(imp.status).toBe(201); // if the import fails, every test below would silently pass on empty data
});
afterAll(() => sequelize.close());

describe("csvCell", () => {
  it("neutralizes formulas and quotes correctly", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+cmd")).toBe("'+cmd");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe("");
    expect(csvCell(12.5)).toBe("12.5");
  });
});

describe("GET /api/exports/csv", () => {
  it("exports campaigns as CSV with the right headers", async () => {
    const res = await get("/api/exports/csv?sortBy=name&order=asc");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain('filename="spendlens-campaign.csv"');
    const lines = res.text.replace("﻿", "").trim().split("\r\n");
    expect(lines[0]).toBe("campaign,spend,impressions,clicks,ctr,cpc,cpm,conversions,cvr,cpa,revenue,roas");
    expect(lines).toHaveLength(4); // header + 3 campaigns (Alpha, formula, Beta)
  });

  it("does not allow formula execution through the campaign name", async () => {
    const res = await get("/api/exports/csv");
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(res.text).not.toMatch(/^=/m);
    expect(res.text).toContain('"Beta, Inc"');
  });

  it("respects filters and supports the daily level", async () => {
    const daily = await get("/api/exports/csv?level=daily&from=2026-10-02&to=2026-10-02");
    const lines = daily.text.replace("﻿", "").trim().split("\r\n");
    expect(lines[0]).toMatch(/^date,spend/);
    expect(lines).toHaveLength(2);
    expect(lines[1] ?? "").toContain("2026-10-02,100,10000,300");
    const search = await get("/api/exports/csv?search=alpha");
    expect(search.text.trim().split("\r\n")).toHaveLength(2);
  });

  it("isolation: another workspace gets only the header", async () => {
    const other = await registerUser(app, "b@x.com", "B");
    const res = await get("/api/exports/csv", other.token);
    expect(res.text.trim().split("\r\n")).toHaveLength(1);
  });

  it("requires authentication and validates parameters", async () => {
    expect((await request(app).get("/api/exports/csv")).status).toBe(401);
    expect((await get("/api/exports/csv?level=something")).status).toBe(400);
  });
});
