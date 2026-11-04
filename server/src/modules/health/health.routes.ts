import { Router } from "express";
import { sequelize } from "../../database/sequelize";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  try {
    await sequelize.authenticate();
    res.json({ status: "ok", database: "up" });
  } catch {
    res.status(503).json({ status: "degraded", database: "down" });
  }
});
