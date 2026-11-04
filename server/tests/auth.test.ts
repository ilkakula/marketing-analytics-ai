import request from "supertest";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app";
import { sequelize } from "../src/database/sequelize";
import { resetDb } from "./helpers";
import { User, Workspace, WorkspaceMember } from "../src/database/models";

const app = createApp();

const register = (email: string, workspaceName = "Acme") =>
  request(app).post("/api/auth/register").send({ email, password: "supersecret1", name: "Test", workspaceName });

beforeEach(async () => {
  await resetDb();
});
afterAll(() => sequelize.close());

describe("registration", () => {
  it("creates the user, workspace and membership", async () => {
    const res = await register("ana@example.com");
    expect(res.status).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).not.toHaveProperty("passwordHash");
    expect(await WorkspaceMember.count()).toBe(1);
  });

  it("never stores the password in plain text", async () => {
    await register("ana@example.com");
    const user = await User.findOne();
    expect(user!.passwordHash).not.toContain("supersecret1");
    expect(user!.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it("rejects a duplicate email regardless of letter case", async () => {
    await register("ana@example.com");
    const res = await register("ANA@Example.com", "Drugi");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_TAKEN");
    expect(await Workspace.count()).toBe(1); // the transaction left no orphan workspace behind
  });

  it("validates input", async () => {
    const res = await request(app).post("/api/auth/register").send({ email: "nije-email", password: "123" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("login", () => {
  it("logs in with valid credentials", async () => {
    await register("ana@example.com");
    const res = await request(app).post("/api/auth/login").send({ email: "Ana@example.com", password: "supersecret1" });
    expect(res.status).toBe(200);
    expect(res.body.workspace.name).toBe("Acme");
  });

  it("same response for a wrong password and a nonexistent email", async () => {
    await register("ana@example.com");
    const wrong = await request(app).post("/api/auth/login").send({ email: "ana@example.com", password: "pogresna123" });
    const missing = await request(app).post("/api/auth/login").send({ email: "nema@example.com", password: "pogresna123" });
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(missing.body).toEqual(wrong.body);
  });
});

describe("workspace isolation", () => {
  it("each user sees only their own workspace", async () => {
    const a = await register("a@example.com", "Company A");
    const b = await register("b@example.com", "Company B");
    const resA = await request(app).get("/api/workspaces/current").set("Authorization", `Bearer ${a.body.token}`);
    const resB = await request(app).get("/api/workspaces/current").set("Authorization", `Bearer ${b.body.token}`);
    expect(resA.body.name).toBe("Company A");
    expect(resB.body.name).toBe("Company B");
  });

  it("a token carrying another workspace is rejected (403)", async () => {
    const a = await register("a@example.com", "Company A");
    const b = await register("b@example.com", "Company B");
    // An attacker holding a valid signature (e.g. due to a bug) who writes someone else's workspace:
    const forged = jwt.sign({ wid: b.body.workspace.id }, process.env.JWT_SECRET!, { subject: a.body.user.id });
    const res = await request(app).get("/api/workspaces/current").set("Authorization", `Bearer ${forged}`);
    expect(res.status).toBe(403);
  });
});

describe("route protection", () => {
  it("no token gives 401", async () => {
    expect((await request(app).get("/api/workspaces/current")).status).toBe(401);
  });
  it("bad token gives 401", async () => {
    const res = await request(app).get("/api/workspaces/current").set("Authorization", "Bearer garbage");
    expect(res.status).toBe(401);
  });
  it("token signed with a different key gives 401", async () => {
    const bad = jwt.sign({ wid: "x" }, "some-other-key-some-other-key-1234", { subject: "y" });
    const res = await request(app).get("/api/workspaces/current").set("Authorization", `Bearer ${bad}`);
    expect(res.status).toBe(401);
  });
});
