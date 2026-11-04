import {
  DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes,
} from "sequelize";
import { sequelize } from "./sequelize";

export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
  declare id: CreationOptional<string>;
  declare email: string;
  declare name: string;
  declare passwordHash: string;
}
User.init(
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    email: { type: "CITEXT", allowNull: false, unique: true },
    name: { type: DataTypes.STRING(120), allowNull: false },
    passwordHash: { type: DataTypes.STRING, allowNull: false },
  },
  { sequelize, tableName: "users" },
);

export class Workspace extends Model<InferAttributes<Workspace>, InferCreationAttributes<Workspace>> {
  declare id: CreationOptional<string>;
  declare name: string;
  declare currency: CreationOptional<string>;
  declare timezone: CreationOptional<string>;
  declare targetRoas: CreationOptional<number | string>; // DECIMAL comes back as a string from pg
}
Workspace.init(
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    name: { type: DataTypes.STRING(120), allowNull: false },
    currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: "USD" },
    timezone: { type: DataTypes.STRING(64), allowNull: false, defaultValue: "UTC" },
    targetRoas: { type: DataTypes.DECIMAL(6, 2), allowNull: false, defaultValue: 1 },
  },
  { sequelize, tableName: "workspaces" },
);

export class WorkspaceMember extends Model<
  InferAttributes<WorkspaceMember>, InferCreationAttributes<WorkspaceMember>
> {
  declare id: CreationOptional<string>;
  declare userId: string;
  declare workspaceId: string;
  declare role: CreationOptional<string>;
}
WorkspaceMember.init(
  {
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    userId: { type: DataTypes.UUID, allowNull: false },
    workspaceId: { type: DataTypes.UUID, allowNull: false },
    role: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "owner" },
  },
  { sequelize, tableName: "workspace_members" },
);

User.belongsToMany(Workspace, { through: WorkspaceMember, foreignKey: "userId", otherKey: "workspaceId" });
Workspace.belongsToMany(User, { through: WorkspaceMember, foreignKey: "workspaceId", otherKey: "userId" });
WorkspaceMember.belongsTo(Workspace, { foreignKey: "workspaceId" });
WorkspaceMember.belongsTo(User, { foreignKey: "userId" });

// ---------- Marketing data ----------
const uuidPk = { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 } as const;

export class DataSource extends Model<InferAttributes<DataSource>, InferCreationAttributes<DataSource>> {
  declare id: CreationOptional<string>;
  declare workspaceId: string;
  declare provider: string;
  declare name: string;
  declare credentials: CreationOptional<object | null>;
}
DataSource.init(
  {
    id: uuidPk,
    workspaceId: { type: DataTypes.UUID, allowNull: false },
    provider: { type: DataTypes.STRING(30), allowNull: false },
    name: { type: DataTypes.STRING(120), allowNull: false },
    credentials: { type: DataTypes.JSONB, allowNull: true },
  },
  { sequelize, tableName: "data_sources" },
);

export class Campaign extends Model<InferAttributes<Campaign>, InferCreationAttributes<Campaign>> {
  declare id: CreationOptional<string>;
  declare workspaceId: string;
  declare dataSourceId: string;
  declare externalId: string;
  declare name: string;
  declare objective: CreationOptional<string | null>;
}
Campaign.init(
  {
    id: uuidPk,
    workspaceId: { type: DataTypes.UUID, allowNull: false },
    dataSourceId: { type: DataTypes.UUID, allowNull: false },
    externalId: { type: DataTypes.STRING(255), allowNull: false },
    name: { type: DataTypes.STRING(255), allowNull: false },
    objective: { type: DataTypes.STRING(100), allowNull: true },
  },
  { sequelize, tableName: "campaigns" },
);

export class AdSet extends Model<InferAttributes<AdSet>, InferCreationAttributes<AdSet>> {
  declare id: CreationOptional<string>;
  declare workspaceId: string;
  declare campaignId: string;
  declare externalId: string;
  declare name: string;
}
AdSet.init(
  {
    id: uuidPk,
    workspaceId: { type: DataTypes.UUID, allowNull: false },
    campaignId: { type: DataTypes.UUID, allowNull: false },
    externalId: { type: DataTypes.STRING(255), allowNull: false },
    name: { type: DataTypes.STRING(255), allowNull: false },
  },
  { sequelize, tableName: "ad_sets" },
);

export class Ad extends Model<InferAttributes<Ad>, InferCreationAttributes<Ad>> {
  declare id: CreationOptional<string>;
  declare workspaceId: string;
  declare adSetId: string;
  declare externalId: string;
  declare name: string;
  declare creativeName: CreationOptional<string | null>;
}
Ad.init(
  {
    id: uuidPk,
    workspaceId: { type: DataTypes.UUID, allowNull: false },
    adSetId: { type: DataTypes.UUID, allowNull: false },
    externalId: { type: DataTypes.STRING(255), allowNull: false },
    name: { type: DataTypes.STRING(255), allowNull: false },
    creativeName: { type: DataTypes.STRING(255), allowNull: true },
  },
  { sequelize, tableName: "ads" },
);

export class DailyMetric extends Model<InferAttributes<DailyMetric>, InferCreationAttributes<DailyMetric>> {
  declare id: CreationOptional<string>;
  declare workspaceId: string;
  declare adId: string;
  declare date: string;
  declare spend: number | string;
  declare impressions: number;
  declare clicks: number;
  declare conversions: number;
  declare revenue: number | string;
  declare importJobId: CreationOptional<string | null>; // the import that wrote this row last
}
DailyMetric.init(
  {
    id: uuidPk,
    workspaceId: { type: DataTypes.UUID, allowNull: false },
    adId: { type: DataTypes.UUID, allowNull: false },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    spend: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    impressions: { type: DataTypes.INTEGER, allowNull: false },
    clicks: { type: DataTypes.INTEGER, allowNull: false },
    conversions: { type: DataTypes.INTEGER, allowNull: false },
    revenue: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    importJobId: { type: DataTypes.UUID, allowNull: true },
  },
  { sequelize, tableName: "daily_metrics" },
);

export type ImportStatus = "processing" | "completed" | "completed_with_errors" | "failed" | "undone";
export interface ImportRowError { row: number; column?: string; message: string }

export class ImportJob extends Model<InferAttributes<ImportJob>, InferCreationAttributes<ImportJob>> {
  declare id: CreationOptional<string>;
  declare workspaceId: string;
  declare userId: string;
  declare filename: string;
  declare status: ImportStatus;
  declare totalRows: CreationOptional<number>;
  declare rowsImported: CreationOptional<number>;
  declare rowsFailed: CreationOptional<number>;
  declare errors: CreationOptional<ImportRowError[]>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
ImportJob.init(
  {
    id: uuidPk,
    workspaceId: { type: DataTypes.UUID, allowNull: false },
    userId: { type: DataTypes.UUID, allowNull: false },
    filename: { type: DataTypes.STRING(255), allowNull: false },
    status: { type: DataTypes.STRING(30), allowNull: false },
    totalRows: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    rowsImported: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    rowsFailed: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    errors: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "import_jobs" },
);

Campaign.hasMany(AdSet, { foreignKey: "campaignId" });
AdSet.belongsTo(Campaign, { foreignKey: "campaignId" });
AdSet.hasMany(Ad, { foreignKey: "adSetId" });
Ad.belongsTo(AdSet, { foreignKey: "adSetId" });
Ad.hasMany(DailyMetric, { foreignKey: "adId" });
DailyMetric.belongsTo(Ad, { foreignKey: "adId" });

export class ImportMapping extends Model<InferAttributes<ImportMapping>, InferCreationAttributes<ImportMapping>> {
  declare id: CreationOptional<string>;
  declare workspaceId: string;
  declare signature: string;
  declare mapping: Record<string, string>;
}
ImportMapping.init(
  {
    id: uuidPk,
    workspaceId: { type: DataTypes.UUID, allowNull: false },
    signature: { type: DataTypes.STRING(40), allowNull: false },
    mapping: { type: DataTypes.JSONB, allowNull: false },
  },
  { sequelize, tableName: "import_mappings" },
);
