import { DataTypes, type QueryInterface } from "sequelize";

// A column mapping the user chose by hand, remembered per workspace and per file layout (signature),
// so the next file with the same columns imports without the mapping step.
export const up = async ({ context: qi }: { context: QueryInterface }) => {
  await qi.createTable("import_mappings", {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: qi.sequelize.literal("gen_random_uuid()") },
    workspace_id: { type: DataTypes.UUID, allowNull: false, references: { model: "workspaces", key: "id" }, onDelete: "CASCADE" },
    signature: { type: DataTypes.STRING(40), allowNull: false },
    mapping: { type: DataTypes.JSONB, allowNull: false },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  });
  await qi.addConstraint("import_mappings", { fields: ["workspace_id", "signature"], type: "unique", name: "import_mappings_workspace_signature_uniq" });
};
export const down = async ({ context: qi }: { context: QueryInterface }) => { await qi.dropTable("import_mappings"); };
