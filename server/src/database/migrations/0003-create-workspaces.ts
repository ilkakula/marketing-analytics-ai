import { DataTypes, type QueryInterface } from "sequelize";

export const up = async ({ context: qi }: { context: QueryInterface }) => {
  await qi.createTable("workspaces", {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: qi.sequelize.literal("gen_random_uuid()") },
    name: { type: DataTypes.STRING(120), allowNull: false },
    currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: "USD" },
    timezone: { type: DataTypes.STRING(64), allowNull: false, defaultValue: "UTC" },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  });
};
export const down = async ({ context: qi }: { context: QueryInterface }) => {
  await qi.dropTable("workspaces");
};
