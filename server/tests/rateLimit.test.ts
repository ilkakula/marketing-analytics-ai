import request from "supertest";
import { createApp } from "../src/app";
import { sequelize } from "../src/database/sequelize";
import { registerUser, resetDb } from "./helpers";

const creds = (email: string, password = "pogresna123") => ({ email, password });
beforeEach(resetDb);
afterAll(() => sequelize.close());

describe("login attempt limiting", () => {
  it("blocks password guessing on the same account after N failed attempts", async () => {
    const app = createApp({ authLimits: { loginLimit: 3, ipLimit: 1000 } });
    await registerUser(app, "ana@x.com");
    for (let i = 0; i < 3; i++) {
      expect((await request(app).post("/api/auth/login").send(creds("ana@x.com"))).status).toBe(401);
    }
    const blocked = await request(app).post("/api/auth/login").send(creds("ana@x.com"));
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("RATE_LIMITED");
    expect(blocked.headers["retry-after"]).toBeDefined();
    // even the correct password is rejected while blocked (an attacker must not learn they guessed it)
    expect((await request(app).post("/api/auth/login").send(creds("ana@x.com", "supersecret1"))).status).toBe(429);
  });

  it("does not block other accounts, and the email is compared case-insensitively", async () => {
    const app = createApp({ authLimits: { loginLimit: 2, ipLimit: 1000 } });
    await registerUser(app, "ana@x.com");
    await request(app).post("/api/auth/login").send(creds("ana@x.com"));
    await request(app).post("/api/auth/login").send(creds("ANA@x.com"));
    expect((await request(app).post("/api/auth/login").send(creds("Ana@X.com"))).status).toBe(429);
    expect((await request(app).post("/api/auth/login").send(creds("drugi@x.com"))).status).toBe(401);
  });

  it("successful logins are not counted", async () => {
    const app = createApp({ authLimits: { loginLimit: 2, ipLimit: 1000 } });
    await registerUser(app, "ana@x.com");
    for (let i = 0; i < 6; i++) {
      expect((await request(app).post("/api/auth/login").send(creds("ana@x.com", "supersecret1"))).status).toBe(200);
    }
  });

  it("the overall per-IP limit slows down rotating emails", async () => {
    const app = createApp({ authLimits: { loginLimit: 1000, ipLimit: 3 } });
    for (let i = 0; i < 3; i++) await request(app).post("/api/auth/login").send(creds(`user${i}@x.com`));
    expect((await request(app).post("/api/auth/login").send(creds("novi@x.com"))).status).toBe(429);
    expect((await request(app).post("/api/auth/register").send({ email: "n@x.com", password: "supersecret1", name: "N", workspaceName: "W" })).status).toBe(429);
  });

  it("other routes are not under the auth limit", async () => {
    const app = createApp({ authLimits: { loginLimit: 1, ipLimit: 1 } });
    for (let i = 0; i < 5; i++) expect((await request(app).get("/api/health")).status).toBe(200);
  });
});

describe("trust proxy (behind nginx)", () => {
  const attempt = (app: ReturnType<typeof createApp>, ip: string) =>
    request(app).post("/api/auth/login").set("X-Forwarded-For", ip).send(creds("ana@x.com"));

  it("with 1 proxy every client has its own counter (by X-Forwarded-For)", async () => {
    const app = createApp({ authLimits: { loginLimit: 1, ipLimit: 1000 }, trustProxyHops: 1 });
    expect((await attempt(app, "1.1.1.1")).status).toBe(401);
    expect((await attempt(app, "1.1.1.1")).status).toBe(429);
    expect((await attempt(app, "2.2.2.2")).status).toBe(401); // the other client is not penalized
  });

  it("without trusting the proxy, a forged header cannot bypass the limit", async () => {
    const app = createApp({ authLimits: { loginLimit: 1, ipLimit: 1000 }, trustProxyHops: 0 });
    expect((await attempt(app, "1.1.1.1")).status).toBe(401);
    expect((await attempt(app, "9.9.9.9")).status).toBe(429); // the attacker changes the header, still the same counter
  });
});
