import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { UniqueConstraintError } from "sequelize";
import { env } from "../../config/env";
import { sequelize } from "../../database/sequelize";
import { User, Workspace, WorkspaceMember } from "../../database/models";
import { AppError, unauthorized } from "../../shared/errors";

const BCRYPT_COST = env.NODE_ENV === "test" ? 4 : 12;
// Hash for a nonexistent user: login takes the same time whether or not the email exists,
// so an attacker cannot discover registered emails by timing responses.
const DUMMY_HASH = bcrypt.hashSync("dummy-password", BCRYPT_COST);

export interface TokenPayload {
  sub: string; // userId
  wid: string; // workspaceId
}

function signToken(userId: string, workspaceId: string): string {
  return jwt.sign({ wid: workspaceId }, env.JWT_SECRET, {
    subject: userId,
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

export function verifyToken(token: string): TokenPayload {
  const payload = jwt.verify(token, env.JWT_SECRET);
  if (typeof payload === "string" || !payload.sub || typeof payload.wid !== "string") {
    throw new Error("Invalid token");
  }
  return { sub: payload.sub, wid: payload.wid };
}

const publicUser = (u: User) => ({ id: u.id, email: u.email, name: u.name });

export async function register(input: {
  email: string; password: string; name: string; workspaceName: string;
}) {
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);
  try {
    // Transaction: either the user + workspace + membership are all created, or nothing is.
    const { user, workspace } = await sequelize.transaction(async (t) => {
      const user = await User.create(
        { email: input.email, name: input.name, passwordHash }, { transaction: t });
      const workspace = await Workspace.create({ name: input.workspaceName }, { transaction: t });
      await WorkspaceMember.create(
        { userId: user.id, workspaceId: workspace.id, role: "owner" }, { transaction: t });
      return { user, workspace };
    });
    return {
      token: signToken(user.id, workspace.id),
      user: publicUser(user),
      workspace: { id: workspace.id, name: workspace.name },
    };
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      throw new AppError(409, "EMAIL_TAKEN", "A user with this email already exists");
    }
    throw err;
  }
}

export async function login(input: { email: string; password: string }) {
  const user = await User.findOne({ where: { email: input.email } });
  const ok = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw unauthorized("Incorrect email or password");

  // MVP: one workspace per user; we take the oldest membership.
  const membership = await WorkspaceMember.findOne({
    where: { userId: user.id }, order: [["createdAt", "ASC"]],
  });
  const workspace = membership && (await Workspace.findByPk(membership.workspaceId));
  if (!membership || !workspace) throw unauthorized("User has no workspace");

  return {
    token: signToken(user.id, membership.workspaceId),
    user: publicUser(user),
    workspace: { id: workspace.id, name: workspace.name },
  };
}
