export interface Metrics {
  spend: number; impressions: number; clicks: number; conversions: number; revenue: number;
  cpm: number | null; ctr: number | null; cpc: number | null; cvr: number | null; cpa: number | null; roas: number | null;
}
export type MetricKey = keyof Metrics;

export interface Summary {
  period: { from: string | null; to: string | null };
  totals: Metrics;
  previous?: { period: { from: string; to: string }; totals: Metrics };
  change?: Record<MetricKey, number | null>;
}
export type Point = Metrics & { date: string };
export type CampaignRow = Metrics & { id: string; name: string };
export type BreakdownRow = Metrics & { id: string; name: string; adSetId?: string };

export interface CampaignList { items: CampaignRow[]; total: number; page: number; pageSize: number }
export interface CampaignDetail {
  id: string; name: string; totals: Metrics; timeseries: Point[]; adSets: BreakdownRow[]; ads: BreakdownRow[];
}
export interface Workspace { id: string; name: string; currency: string; timezone: string }
export interface ImportJob {
  id: string; filename: string; status: "completed" | "completed_with_errors" | "failed" | "undone";
  totalRows: number; rowsImported: number; rowsFailed: number;
  errors: { row: number; column?: string; message: string }[]; errorsTruncated: boolean;
  /** How the columns were matched (only on the response of the import itself). */
  detected?: { kind: "standard" | "meta" | "google" | "saved" | "custom"; mapping: Record<string, string>; headerRow: number };
}
export interface AuthResult {
  token: string; user: { id: string; email: string; name: string }; workspace: { id: string; name: string };
}

export type Notice = "NO_API_KEY" | "RATE_LIMITED" | "LLM_UNAVAILABLE" | "LLM_REJECTED" | "NO_DATA";
export interface AiFinding {
  id: string; type: string; severity: "high" | "medium" | "info"; campaignId: string; campaignName: string;
  message: string; evidence: Record<string, number>;
}
export interface AiResult {
  source: "llm" | "rules"; model?: string; cached: boolean; generatedAt: string; notice?: Notice;
  findings: AiFinding[];
  insights: { summary: string; observations: string[]; recommendations: Array<{ action: string; reason: string; basedOn: string[] }> };
}

export type AskNotice = "NO_API_KEY" | "RATE_LIMITED" | "LLM_UNAVAILABLE" | "LLM_REJECTED" | "NO_DATA";
export interface AskResult {
  question: string; answer: string; source: "llm" | "data"; model?: string; verified: boolean; cached: boolean;
  generatedAt: string; notice?: AskNotice;
  steps: Array<{ tool: string; args: unknown; ok: boolean }>;
}

export interface ImportHistoryItem extends ImportJob { rowsOwned: number; createdAt: string }
