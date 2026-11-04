import request from "supertest";
import { createApp } from "../src/app";
import { sequelize } from "../src/database/sequelize";
import { registerUser, resetDb } from "./helpers";

const app = createApp();
let token: string;
const patch = (body: object, t = token) => request(app).patch("/api/workspaces/current").set("Authorization", `Bearer ${t}`).send(body);
const current = (t = token) => request(app).get("/api/workspaces/current").set("Authorization", `Bearer ${t}`);

beforeEach(async () => { await resetDb(); ({ token } = await registerUser(app, "a@x.com", "Old Name")); });
afterAll(() => sequelize.close());

describe("PATCH /api/workspaces/current", () => {
  it("updates the name and currency", async () => {
    const res = await patch({ name: "  New Agency  ", currency: "eur" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "New Agency", currency: "EUR" }); // trimmed, upper-cased
    expect((await current()).body).toMatchObject({ name: "New Agency", currency: "EUR" });
  });

  it("allows changing only one field", async () => {
    await patch({ currency: "RSD" });
    expect((await current()).body).toMatchObject({ name: "Old Name", currency: "RSD" });
  });

  it("validates input", async () => {
    expect((await patch({ currency: "ZZZ" })).status).toBe(400);
    expect((await patch({ currency: "US" })).status).toBe(400);
    expect((await patch({ name: "   " })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
    expect((await patch({ name: "x".repeat(121) })).status).toBe(400);
  });

  it("ignores attempts to change other fields such as the id", async () => {
    const before = (await current()).body.id;
    const res = await patch({ currency: "GBP", id: "11111111-1111-4111-8111-111111111111", timezone: "Mars/Olympus" });
    expect(res.body.id).toBe(before);
    expect(res.body.timezone).toBe("UTC");
  });

  it("isolation: only the caller's workspace changes", async () => {
    const other = await registerUser(app, "b@x.com", "Other");
    await patch({ name: "Changed", currency: "EUR" });
    expect((await current(other.token)).body).toMatchObject({ name: "Other", currency: "USD" });
  });

  it("requires authentication", async () => {
    expect((await request(app).patch("/api/workspaces/current").send({ currency: "EUR" })).status).toBe(401);
  });
});
