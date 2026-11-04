import { DataTypes, type QueryInterface } from "sequelize";

export const up = async ({ context: qi }: { context: QueryInterface }) => {
  await qi.createTable("users", {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: qi.sequelize.literal("gen_random_uuid()") },
    email: { type: "CITEXT", allowNull: false, unique: true },
    name: { type: DataTypes.STRING(120), allowNull: false },
    password_hash: { type: DataTypes.STRING, allowNull: false },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  });
};
export const down = async ({ context: qi }: { context: QueryInterface }) => {
  await qi.dropTable("users");
};
