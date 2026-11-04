import { Op } from "sequelize";
import { Campaign } from "../../../database/models";
import * as repo from "../../analytics/analytics.repository";
import type { CampaignSort } from "../../analytics/analytics.repository";
import type { Filters } from "../../analytics/filters";
import type { Metrics } from "../../analytics/metrics";

// Everything the AI layer may read goes through this port. Production uses SQL; the evaluation harness
// plugs in an in-memory implementation built from synthetic scenarios, so the SAME tool code is tested.

export type CampaignRow = Metrics & { id: string; name: string };
export type DailyRow = Metrics & { id: string; name: string; date: string };
export type WeeklyCampaignRow = Metrics & { id: string; name: string; week: string; days: number };

export interface AnalyticsPort {
  getTotals(f: Filters): Promise<Metrics>;
  getTimeseries(f: Filters): Promise<Array<Metrics & { date: string }>>;
  getWeekly(f: Filters): Promise<Array<Metrics & { week: string; days: number }>>;
  listCampaigns(f: Filters, o: { search?: string; sortBy: CampaignSort; order: "asc" | "desc"; page: number; pageSize: number }): Promise<{ items: CampaignRow[]; total: number }>;
  getCampaignWeekly(f: Filters): Promise<WeeklyCampaignRow[]>;
  getCampaignDaily(f: Filters): Promise<DailyRow[]>;
  breakdown(f: Filters, level: "ad_set" | "ad"): Promise<Array<Metrics & { id: string; name: string }>>;
  findCampaigns(workspaceId: string, name: string): Promise<Array<{ id: string; name: string }>>;
  dataRange(workspaceId: string): Promise<{ from: string | null; to: string | null }>;
  fingerprint(workspaceId: string): Promise<string>;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

export const sqlPort: AnalyticsPort = {
  getTotals: repo.getTotals,
  getTimeseries: repo.getTimeseries,
  getWeekly: repo.getWeekly,
  listCampaigns: repo.listCampaigns,
  getCampaignWeekly: repo.getCampaignWeekly,
  getCampaignDaily: repo.getCampaignDaily,
  breakdown: repo.breakdown,
  dataRange: repo.getDataRange,
  fingerprint: repo.getDataFingerprint,
  async findCampaigns(workspaceId, name) {
    // workspaceId in the WHERE clause: names from other workspaces are simply not found.
    const rows = await Campaign.findAll({
      where: { workspaceId, name: { [Op.iLike]: `%${escapeLike(name)}%` } }, order: [["name", "ASC"]], limit: 6,
    });
    return rows.map((c) => ({ id: c.id, name: c.name }));
  },
};
