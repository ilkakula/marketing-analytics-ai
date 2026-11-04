import request from "supertest";
import { createApp } from "../src/app";
import { sequelize } from "../src/database/sequelize";
import { Campaign, DailyMetric } from "../src/database/models";
import { registerUser, resetDb } from "./helpers";

const app = createApp();
const H = "date,campaign,ad_set,ad,spend,impressions,clicks,conversions,revenue";
const A = [H, "2026-10-01,Alpha,S,A1,100,10000,200,10,500", "2026-10-02,Alpha,S,A1,100,10000,200,10,500", "2026-10-01,Beta,S,B1,50,5000,50,2,80"].join("\n");
const B = [H, "2026-10-02,Alpha,S,A1,999,10000,200,10,500", "2026-10-03,Gamma,S,G1,10,1000,10,1,20"].join("\n");

let token: string;
const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
const upload = (csv: string, t = token) => request(app).post("/api/imports/csv").set(auth(t)).attach("file", Buffer.from(csv), "d.csv");
const list = (t = token) => request(app).get("/api/imports").set(auth(t));
const undo = (id: string, t = token) => request(app).delete(`/api/imports/${id}`).set(auth(t));
const summary = (t = token) => request(app).get("/api/analytics/summary").set(auth(t)).then((r) => r.body.totals);

beforeEach(async () => { await resetDb(); ({ token } = await registerUser(app, "a@x.com")); });
afterAll(() => sequelize.close());

describe("import history", () => {
  it("lists the workspace's imports newest first with the rows each one still owns", async () => {
    const a = (await upload(A)).body;
    const b = (await upload(B)).body;
    const { items } = (await list()).body;
    expect(items.map((i: { id: string }) => i.id)).toEqual([b.id, a.id]);
    // B overwrote Alpha's 2026-10-02 row, so A owns 2 rows (Alpha 10-01 and Beta 10-01) and B owns 2.
    expect(items.find((i: { id: string }) => i.id === a.id).rowsOwned).toBe(2);
    expect(items.find((i: { id: string }) => i.id === b.id).rowsOwned).toBe(2);
  });

  it("only shows the caller's imports", async () => {
    await upload(A);
    const other = await registerUser(app, "b@x.com", "B");
    expect((await list(other.token)).body.items).toEqual([]);
  });

  it("requires authentication", async () => {
    expect((await request(app).get("/api/imports")).status).toBe(401);
    expect((await request(app).delete("/api/imports/00000000-0000-4000-8000-000000000000")).status).toBe(401);
  });
});

describe("deleting an import", () => {
  it("removes its data and the campaigns that become empty", async () => {
    const a = (await upload(A)).body;
    expect((await summary()).spend).toBe(250);
    const res = await undo(a.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: a.id, status: "undone", deletedRows: 3 });
    expect((await summary()).spend).toBe(0);
    expect(await Campaign.count()).toBe(0); // no empty shells left behind
    const { items } = (await list()).body;
    expect(items[0]).toMatchObject({ id: a.id, status: "undone", rowsOwned: 0 }); // stays in the history
  });

  it("keeps rows that a later import overwrote (last writer wins) and data from other imports", async () => {
    const a = (await upload(A)).body;
    const b = (await upload(B)).body;
    const res = await undo(a.id);
    expect(res.body.deletedRows).toBe(2); // Alpha 10-02 now belongs to B
    expect(await DailyMetric.count()).toBe(2);
    expect((await summary()).spend).toBe(1009); // Alpha 10-02 (999, from B) + Gamma 10 (from B)
    expect(await Campaign.count()).toBe(2); // Alpha and Gamma survive through B; Beta is gone
    expect((await undo(b.id)).body.deletedRows).toBe(2);
    expect(await Campaign.count()).toBe(0);
  });

  it("cannot be repeated (409) and unknown ids are 404", async () => {
    const a = (await upload(A)).body;
    await undo(a.id);
    const again = await undo(a.id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("ALREADY_UNDONE");
    expect((await undo("00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await undo("not-a-uuid")).status).toBe(404);
  });

  it("isolation: another workspace cannot delete this workspace's import", async () => {
    const a = (await upload(A)).body;
    const other = await registerUser(app, "b@x.com", "B");
    expect((await undo(a.id, other.token)).status).toBe(404);
    expect((await summary()).spend).toBe(250); // untouched
  });
});
