import request from "supertest";
import { createApp } from "../src/app";
import { sequelize } from "../src/database/sequelize";
import { Campaign, DailyMetric } from "../src/database/models";
import { registerUser, resetDb } from "./helpers";

const app = createApp();
const H = "date,campaign,ad_set,ad,spend,impressions,clicks,conversions,revenue";
const VALID = [H,
  "2026-10-01,Brand Campaign,Women 25-34,Creative A,100,10000,250,20,500",
  "2026-10-01,Brand Campaign,Women 25-34,Creative B,80,8000,120,8,160"].join("\n");

const upload = (token: string, content: string, name = "data.csv", mapping?: object) => {
  const r = request(app).post("/api/imports/csv").set("Authorization", `Bearer ${token}`)
    .attach("file", Buffer.from(content), name);
  return mapping ? r.field("mapping", JSON.stringify(mapping)) : r;
};

beforeEach(resetDb);
afterAll(() => sequelize.close());

describe("POST /api/imports/csv", () => {
  it("imports a valid file", async () => {
    const { token, workspaceId } = await registerUser(app, "a@x.com");
    const res = await upload(token, VALID);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "completed", totalRows: 2, rowsImported: 2, rowsFailed: 0 });
    expect(await DailyMetric.count({ where: { workspaceId } })).toBe(2);
    expect(await Campaign.count({ where: { workspaceId } })).toBe(1);
  });

  it("partial import: valid rows pass, invalid rows get clear messages", async () => {
    const { token, workspaceId } = await registerUser(app, "a@x.com");
    const res = await upload(token, [VALID, "2026-10-02,Brand Campaign,W,C,abc,10,1,0,0"].join("\n"));
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("completed_with_errors");
    expect(res.body.rowsImported).toBe(2);
    expect(res.body.errors).toEqual([{ row: 4, column: "spend", message: "Must be a non-negative number" }]);
    expect(await DailyMetric.count({ where: { workspaceId } })).toBe(2);
  });

  it("422 when no row is valid", async () => {
    const { token } = await registerUser(app, "a@x.com");
    const res = await upload(token, `${H}\nnot-a-date,A,s,a,1,1,1,1,1`);
    expect(res.status).toBe(422);
    expect(res.body.status).toBe("failed");
  });

  it("re-uploading is idempotent and overwrites values", async () => {
    const { token, workspaceId } = await registerUser(app, "a@x.com");
    await upload(token, VALID);
    await upload(token, VALID.replace("100,10000,250,20,500", "999,10000,250,20,500"));
    expect(await DailyMetric.count({ where: { workspaceId } })).toBe(2);
    const m = await DailyMetric.findOne({ where: { workspaceId }, order: [["spend", "DESC"]] });
    expect(Number(m!.spend)).toBe(999);
  });

  it("400 for missing columns, no file and a wrong extension", async () => {
    const { token } = await registerUser(app, "a@x.com");
    expect((await upload(token, "date,campaign\n2026-10-01,A")).status).toBe(400);
    expect((await upload(token, VALID, "data.txt")).status).toBe(400);
    const none = await request(app).post("/api/imports/csv").set("Authorization", `Bearer ${token}`);
    expect(none.status).toBe(400);
  });

  it("column mapping through the 'mapping' field", async () => {
    const { token } = await registerUser(app, "a@x.com");
    const res = await upload(token, "Day,Name,Cost,Views,Taps,Sales,Income\n2026-10-01,A,1,10,1,0,0", "x.csv",
      { date: "Day", campaign: "Name", spend: "Cost", impressions: "Views", clicks: "Taps", conversions: "Sales", revenue: "Income" });
    expect(res.status).toBe(201);
  });

  it("requires authentication", async () => {
    const res = await request(app).post("/api/imports/csv").attach("file", Buffer.from(VALID), "d.csv");
    expect(res.status).toBe(401);
  });

  it("413 for a file that is too large", async () => {
    const { token } = await registerUser(app, "a@x.com");
    const res = await upload(token, "x".repeat(5 * 1024 * 1024 + 10));
    expect(res.status).toBe(413);
  });
});

describe("import isolation between workspaces", () => {
  it("the same campaign in two workspaces does not collide, and the data stays separate", async () => {
    const a = await registerUser(app, "a@x.com", "A");
    const b = await registerUser(app, "b@x.com", "B");
    await upload(a.token, VALID);
    await upload(b.token, VALID);
    expect(await Campaign.count()).toBe(2);
    expect(await DailyMetric.count({ where: { workspaceId: a.workspaceId } })).toBe(2);
    expect(await DailyMetric.count({ where: { workspaceId: b.workspaceId } })).toBe(2);
  });

  it("another workspace's import job is 404, your own is visible", async () => {
    const a = await registerUser(app, "a@x.com", "A");
    const b = await registerUser(app, "b@x.com", "B");
    const job = (await upload(a.token, VALID)).body;
    const own = await request(app).get(`/api/imports/${job.id}`).set("Authorization", `Bearer ${a.token}`);
    const other = await request(app).get(`/api/imports/${job.id}`).set("Authorization", `Bearer ${b.token}`);
    expect(own.status).toBe(200);
    expect(own.body.rowsImported).toBe(2);
    expect(other.status).toBe(404);
    expect((await request(app).get("/api/imports/not-a-uuid").set("Authorization", `Bearer ${a.token}`)).status).toBe(404);
  });
});
