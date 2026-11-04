import { DataTypes, type QueryInterface } from "sequelize";

export const up = async ({ context: qi }: { context: QueryInterface }) => {
  await qi.createTable("workspace_members", {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: qi.sequelize.literal("gen_random_uuid()") },
    user_id: { type: DataTypes.UUID, allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE" },
    workspace_id: { type: DataTypes.UUID, allowNull: false, references: { model: "workspaces", key: "id" }, onDelete: "CASCADE" },
    role: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "owner" },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  });
  // A user can be a member of a workspace only once.
  await qi.addConstraint("workspace_members", {
    fields: ["user_id", "workspace_id"],
    type: "unique",
    name: "workspace_members_user_workspace_uniq",
  });
  await qi.addIndex("workspace_members", ["workspace_id"]);
};
export const down = async ({ context: qi }: { context: QueryInterface }) => {
  await qi.dropTable("workspace_members");
};
