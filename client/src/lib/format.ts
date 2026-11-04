import type { MetricKey } from "./types";

export const DASH = "—";

export interface Fmt {
  money: (v: number | null, digits?: number) => string;
  int: (v: number | null) => string;
  pct: (v: number | null) => string;
  ratio: (v: number | null) => string;
  metric: (k: MetricKey, v: number | null) => string;
}

export function makeFmt(currency = "USD"): Fmt {
  const money = (v: number | null, digits = 2) =>
    v === null ? DASH : new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "narrowSymbol", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
  const int = (v: number | null) => (v === null ? DASH : new Intl.NumberFormat("en-US").format(v));
  const pct = (v: number | null) => (v === null ? DASH : `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(v)}%`);
  const ratio = (v: number | null) => (v === null ? DASH : `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(v)}×`);
  const metric = (k: MetricKey, v: number | null) => {
    switch (k) {
      case "spend": case "revenue": return money(v, 0);
      case "cpm": case "cpc": case "cpa": return money(v);
      case "ctr": case "cvr": return pct(v);
      case "roas": return ratio(v);
      default: return int(v);
    }
  };
  return { money, int, pct, ratio, metric };
}

export const compact = (v: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v);

export const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" });
export const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
