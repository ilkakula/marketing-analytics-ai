import type { RequestHandler } from "express";
import { WorkspaceMember } from "../database/models";
import { forbidden, unauthorized } from "../shared/errors";
import { verifyToken } from "../modules/auth/auth.service";

declare module "express-serve-static-core" {
  interface Request {
    auth?: { userId: string; workspaceId: string };
  }
}

// Every business route goes through this. Two steps:
// 1) the token is valid (signature + expiry), 2) the user is STILL a member of the token's workspace.
// The second step is data isolation: workspaceId never comes from the URL or body,
// only from the verified membership.
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw unauthorized("Missing token");

  let payload;
  try {
    payload = verifyToken(header.slice(7));
  } catch {
    throw unauthorized("Token is invalid or expired");
  }

  const member = await WorkspaceMember.findOne({
    where: { userId: payload.sub, workspaceId: payload.wid },
  });
  if (!member) throw forbidden("You do not have access to this workspace");

  req.auth = { userId: payload.sub, workspaceId: payload.wid };
  next();
};
