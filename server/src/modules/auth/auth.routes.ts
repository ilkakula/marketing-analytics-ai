import { Router } from "express";
import { authLimiters, type AuthLimits } from "../../middleware/rateLimit";
import { loginSchema, registerSchema } from "./auth.schemas";
import * as authService from "./auth.service";

export function createAuthRouter(limits: AuthLimits) {
  const { perIp, login } = authLimiters(limits);
  const router = Router();
  router.use(perIp);

  router.post("/register", async (req, res) => {
    const input = registerSchema.parse(req.body);
    res.status(201).json(await authService.register(input));
  });

  router.post("/login", login, async (req, res) => {
    const input = loginSchema.parse(req.body);
    res.json(await authService.login(input));
  });
  return router;
}
