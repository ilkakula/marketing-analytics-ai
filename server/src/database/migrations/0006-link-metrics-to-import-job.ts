import { DataTypes, type QueryInterface } from "sequelize";

// Every metric row remembers which import wrote it LAST. That is what makes "delete this import" possible:
// we remove the rows the import currently owns (if a later import overwrote a day, that row belongs to the later one).
export const up = async ({ context: qi }: { context: QueryInterface }) => {
  await qi.addColumn("daily_metrics", "import_job_id", {
    type: DataTypes.UUID, allowNull: true, references: { model: "import_jobs", key: "id" }, onDelete: "SET NULL",
  });
  await qi.addIndex("daily_metrics", ["import_job_id"]);
};
export const down = async ({ context: qi }: { context: QueryInterface }) => {
  await qi.removeColumn("daily_metrics", "import_job_id");
};
