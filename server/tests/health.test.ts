import request from "supertest";
import { createApp } from "../src/app";
import { sequelize } from "../src/database/sequelize";

const app = createApp();
afterAll(() => sequelize.close());

describe("GET /api/health", () => {
  it("returns ok when the database is reachable", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", database: "up" });
  });
});

describe("error handling", () => {
  it("an unknown route returns 404 in the standard format", async () => {
    const res = await request(app).get("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
