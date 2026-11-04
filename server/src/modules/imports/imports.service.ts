import type { Model, ModelStatic, Transaction } from "sequelize";
import { sequelize } from "../../database/sequelize";
import {
  Ad, AdSet, Campaign, DailyMetric, DataSource, ImportJob, type ImportRowError, type ImportStatus,
} from "../../database/models";
import { notFound } from "../../shared/errors";
import { type ColumnMapping, parseCsv } from "./csv.adapter";
import type { AdMetric } from "./adMetric";

const CHUNK = 1000; // 9 columns * 1000 rows stays far below the Postgres limit of 65535 parameters
const MAX_STORED_ERRORS = 100;

async function chunkedUpsert<M extends Model>(
  model: ModelStatic<M>, rows: object[], conflict: string[], update: string[], t: Transaction,
): Promise<M[]> {
  const out: M[] = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    out.push(...(await model.bulkCreate(rows.slice(i, i + CHUNK) as never[], {
      transaction: t, conflictAttributes: conflict, updateOnDuplicate: [...update, "updatedAt"] as never[], returning: true,
    } as never)));
  }
  return out;
}

// Every row is already normalized (AdMetric); here we persist it with no knowledge of CSV.
export async function persistMetrics(workspaceId: string, metrics: AdMetric[], t: Transaction) {
  const [source] = await DataSource.findOrCreate({
    where: { workspaceId, provider: "csv" }, defaults: { workspaceId, provider: "csv", name: "CSV upload" }, transaction: t,
  });

  const campaignRows = new Map<string, object>();
  for (const m of metrics) {
    campaignRows.set(m.campaignExternalId, {
      workspaceId, dataSourceId: source.id, externalId: m.campaignExternalId, name: m.campaignName,
    });
  }
  const campaigns = await chunkedUpsert(Campaign, [...campaignRows.values()],
    ["workspaceId", "dataSourceId", "externalId"], ["name"], t);
  const campaignId = new Map(campaigns.map((c) => [c.externalId, c.id]));

  const adSetRows = new Map<string, object>();
  for (const m of metrics) {
    const cid = campaignId.get(m.campaignExternalId)!;
    adSetRows.set(`${cid}|${m.adSetExternalId}`, {
      workspaceId, campaignId: cid, externalId: m.adSetExternalId, name: m.adSetName,
    });
  }
  const adSets = await chunkedUpsert(AdSet, [...adSetRows.values()], ["campaignId", "externalId"], ["name"], t);
  const adSetId = new Map(adSets.map((a) => [`${a.campaignId}|${a.externalId}`, a.id]));

  const adRows = new Map<string, object>();
  for (const m of metrics) {
    const sid = adSetId.get(`${campaignId.get(m.campaignExternalId)}|${m.adSetExternalId}`)!;
    adRows.set(`${sid}|${m.adExternalId}`, {
      workspaceId, adSetId: sid, externalId: m.adExternalId, name: m.adName,
    });
  }
  const ads = await chunkedUpsert(Ad, [...adRows.values()], ["adSetId", "externalId"], ["name"], t);
  const adId = new Map(ads.map((a) => [`${a.adSetId}|${a.externalId}`, a.id]));

  const metricRows = metrics.map((m) => {
    const sid = adSetId.get(`${campaignId.get(m.campaignExternalId)}|${m.adSetExternalId}`)!;
    return {
      workspaceId, adId: adId.get(`${sid}|${m.adExternalId}`)!, date: m.date, spend: m.spend,
      impressions: m.impressions, clicks: m.clicks, conversions: m.conversions, revenue: m.revenue,
    };
  });
  // Re-uploading the same file OVERWRITES values (idempotent), it never duplicates.
  await chunkedUpsert(DailyMetric, metricRows, ["adId", "date"],
    ["spend", "impressions", "clicks", "conversions", "revenue"], t);
}

export async function importCsv(args: {
  workspaceId: string; userId: string; filename: string; buffer: Buffer; mapping: ColumnMapping;
}) {
  // File structure errors (missing columns, empty file) throw a 400 before a job is created.
  const parsed = parseCsv(args.buffer, args.mapping);

  const job = await ImportJob.create({
    workspaceId: args.workspaceId, userId: args.userId, filename: args.filename, status: "processing",
    totalRows: parsed.totalRows, rowsFailed: parsed.errors.length,
    errors: parsed.errors.slice(0, MAX_STORED_ERRORS),
  });

  try {
    if (parsed.metrics.length > 0) {
      // All or nothing for the VALID rows: if the write fails midway, no half-finished import remains.
      await sequelize.transaction((t) => persistMetrics(args.workspaceId, parsed.metrics, t));
    }
    const status: ImportStatus = parsed.metrics.length === 0 ? "failed"
      : parsed.errors.length ? "completed_with_errors" : "completed";
    await job.update({ status, rowsImported: parsed.metrics.length });
  } catch (err) {
    const e: ImportRowError = { row: 0, message: "Internal error while writing data" };
    await job.update({ status: "failed", rowsImported: 0, errors: [e, ...job.errors].slice(0, MAX_STORED_ERRORS) });
    throw err;
  }
  return serializeJob(job);
}

export async function getImport(workspaceId: string, id: string) {
  // workspaceId in the WHERE clause: another workspace's job "does not exist" rather than being "forbidden" (we do not reveal it exists).
  const job = await ImportJob.findOne({ where: { id, workspaceId } });
  if (!job) throw notFound("Import not found");
  return serializeJob(job);
}

function serializeJob(job: ImportJob) {
  return {
    id: job.id, filename: job.filename, status: job.status, totalRows: job.totalRows,
    rowsImported: job.rowsImported, rowsFailed: job.rowsFailed, errors: job.errors,
    errorsTruncated: job.rowsFailed > job.errors.length, createdAt: job.createdAt,
  };
}
