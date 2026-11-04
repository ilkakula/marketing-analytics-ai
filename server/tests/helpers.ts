import request from "supertest";
import type { Express } from "express";
import { sequelize } from "../src/database/sequelize";

export const resetDb = () =>
  sequelize.query(
    "TRUNCATE users, workspaces, workspace_members, data_sources, campaigns, ad_sets, ads, daily_metrics, import_jobs CASCADE");

export async function registerUser(app: Express, email: string, workspaceName = "Acme") {
  const res = await request(app).post("/api/auth/register")
    .send({ email, password: "supersecret1", name: "Test", workspaceName });
  return { token: res.body.token as string, workspaceId: res.body.workspace.id as string };
}
