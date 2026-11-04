import type { MetricKey } from "./types";

export const METRIC_LABEL: Record<MetricKey, string> = {
  spend: "Spend", impressions: "Impressions", clicks: "Clicks", conversions: "Conversions", revenue: "Revenue",
  cpm: "CPM", ctr: "CTR", cpc: "CPC", cvr: "CVR", cpa: "CPA", roas: "ROAS",
};

/** Whether growth is good (up), bad (down) or neutral. A rising cost per action is not good news. */
export const POLARITY: Record<MetricKey, "up" | "down" | "neutral"> = {
  spend: "neutral", impressions: "neutral", clicks: "up", conversions: "up", revenue: "up",
  cpm: "down", ctr: "up", cpc: "down", cvr: "up", cpa: "down", roas: "up",
};
