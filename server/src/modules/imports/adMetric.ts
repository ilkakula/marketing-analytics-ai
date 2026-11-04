// The shared internal format. EVERY source (CSV today, Meta API tomorrow) is translated into this,
// and the rest of the app (import service, analytics) does not know where the data comes from.
// Deviation from the original definition: besides external IDs we also carry names, because a CSV has no
// dedicated ID (we derive the ID from the name) and the UI displays names.
export interface AdMetric {
  date: string; // YYYY-MM-DD
  campaignExternalId: string;
  campaignName: string;
  adSetExternalId: string;
  adSetName: string;
  adExternalId: string;
  adName: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
}

export const UNASSIGNED = "(unassigned)";

// "  Brand   Campaign " and "brand campaign" are the same campaign.
export const toExternalId = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
