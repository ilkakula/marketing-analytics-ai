import { z } from "zod";

const email = z.string().trim().toLowerCase().pipe(z.email());

export const registerSchema = z.object({
  email,
  password: z.string().min(8, "Password must be at least 8 characters").max(72),
  name: z.string().trim().min(1).max(120),
  workspaceName: z.string().trim().min(1).max(120),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1),
});
