import { DataTypes, type QueryInterface } from "sequelize";

const uuidPk = (qi: QueryInterface) => ({
  type: DataTypes.UUID, primaryKey: true, defaultValue: qi.sequelize.literal("gen_random_uuid()"),
});
const ref = (table: string) => ({
  type: DataTypes.UUID, allowNull: false, references: { model: table, key: "id" }, onDelete: "CASCADE",
});
const timestamps = {
  created_at: { type: DataTypes.DATE, allowNull: false },
  updated_at: { type: DataTypes.DATE, allowNull: false },
};

// Rule: EVERY business table has workspace_id (even if it is reachable through a parent),
// so any query can filter directly and isolation never depends on JOINs.
export const up = async ({ context: qi }: { context: QueryInterface }) => {
  await qi.createTable("data_sources", {
    id: uuidPk(qi),
    workspace_id: ref("workspaces"),
    provider: { type: DataTypes.STRING(30), allowNull: false },
    name: { type: DataTypes.STRING(120), allowNull: false },
    credentials: { type: DataTypes.JSONB, allowNull: true }, // encrypted later (Meta tokens)
    ...timestamps,
  });
  await qi.addIndex("data_sources", ["workspace_id", "provider"]);

  await qi.createTable("campaigns", {
    id: uuidPk(qi),
    workspace_id: ref("workspaces"),
    data_source_id: ref("data_sources"),
    external_id: { type: DataTypes.STRING(255), allowNull: false },
    name: { type: DataTypes.STRING(255), allowNull: false },
    objective: { type: DataTypes.STRING(100), allowNull: true },
    ...timestamps,
  });
  await qi.addConstraint("campaigns", {
    fields: ["workspace_id", "data_source_id", "external_id"], type: "unique", name: "campaigns_source_external_uniq",
  });

  await qi.createTable("ad_sets", {
    id: uuidPk(qi),
    workspace_id: ref("workspaces"),
    campaign_id: ref("campaigns"),
    external_id: { type: DataTypes.STRING(255), allowNull: false },
    name: { type: DataTypes.STRING(255), allowNull: false },
    ...timestamps,
  });
  await qi.addConstraint("ad_sets", {
    fields: ["campaign_id", "external_id"], type: "unique", name: "ad_sets_campaign_external_uniq",
  });
  await qi.addIndex("ad_sets", ["workspace_id"]);

  await qi.createTable("ads", {
    id: uuidPk(qi),
    workspace_id: ref("workspaces"),
    ad_set_id: ref("ad_sets"),
    external_id: { type: DataTypes.STRING(255), allowNull: false },
    name: { type: DataTypes.STRING(255), allowNull: false },
    creative_name: { type: DataTypes.STRING(255), allowNull: true },
    ...timestamps,
  });
  await qi.addConstraint("ads", {
    fields: ["ad_set_id", "external_id"], type: "unique", name: "ads_ad_set_external_uniq",
  });
  await qi.addIndex("ads", ["workspace_id"]);

  await qi.createTable("daily_metrics", {
    id: uuidPk(qi),
    workspace_id: ref("workspaces"),
    ad_id: ref("ads"),
    date: { type: DataTypes.DATEONLY, allowNull: false },
    spend: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    impressions: { type: DataTypes.INTEGER, allowNull: false },
    clicks: { type: DataTypes.INTEGER, allowNull: false },
    conversions: { type: DataTypes.INTEGER, allowNull: false },
    revenue: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    ...timestamps,
  });
  // The key that enables upserts: one row per ad and day.
  await qi.addConstraint("daily_metrics", {
    fields: ["ad_id", "date"], type: "unique", name: "daily_metrics_ad_date_uniq",
  });
  await qi.addIndex("daily_metrics", ["workspace_id", "date"]);
  await qi.sequelize.query(
    "ALTER TABLE daily_metrics ADD CONSTRAINT daily_metrics_nonneg CHECK (spend >= 0 AND impressions >= 0 AND clicks >= 0 AND conversions >= 0 AND revenue >= 0)");

  await qi.createTable("import_jobs", {
    id: uuidPk(qi),
    workspace_id: ref("workspaces"),
    user_id: ref("users"),
    filename: { type: DataTypes.STRING(255), allowNull: false },
    status: { type: DataTypes.STRING(30), allowNull: false },
    total_rows: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    rows_imported: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    rows_failed: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    errors: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    ...timestamps,
  });
  await qi.addIndex("import_jobs", ["workspace_id", "created_at"]);
};

export const down = async ({ context: qi }: { context: QueryInterface }) => {
  for (const t of ["import_jobs", "daily_metrics", "ads", "ad_sets", "campaigns", "data_sources"]) {
    await qi.dropTable(t);
  }
};
