import { DataTypes, type QueryInterface } from "sequelize";

// The ROAS the user wants to reach. 1 = break-even (the old, fixed behavior), so existing workspaces keep their results.
export const up = async ({ context: qi }: { context: QueryInterface }) => {
  await qi.addColumn("workspaces", "target_roas", { type: DataTypes.DECIMAL(6, 2), allowNull: false, defaultValue: 1 });
  await qi.sequelize.query("ALTER TABLE workspaces ADD CONSTRAINT workspaces_target_roas_range CHECK (target_roas >= 1 AND target_roas <= 100)");
};
export const down = async ({ context: qi }: { context: QueryInterface }) => {
  await qi.removeColumn("workspaces", "target_roas");
};
