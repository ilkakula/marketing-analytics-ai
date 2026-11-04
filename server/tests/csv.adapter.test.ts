import { parseCsv } from "../src/modules/imports/csv.adapter";

const H = "date,campaign,ad_set,ad,spend,impressions,clicks,conversions,revenue";
const csv = (...lines: string[]) => Buffer.from([H, ...lines].join("\n"));

describe("parseCsv", () => {
  it("parses a valid row and derives the external ID from the name", () => {
    const r = parseCsv(csv("2026-10-01, Brand  Campaign ,Women 25-34,Creative A,100,10000,250,20,500"));
    expect(r.errors).toEqual([]);
    expect(r.metrics[0]).toMatchObject({
      campaignExternalId: "brand campaign", campaignName: "Brand  Campaign",
      spend: 100, clicks: 250, revenue: 500, row: 2,
    });
  });

  it("reports errors per row and column, and accepts the other rows", () => {
    const r = parseCsv(csv(
      "2026-10-01,A,s,a,100,1000,10,1,50",
      "2026-13-45,A,s,a,100,1000,10,1,50",
      "2026-10-02,A,s,a,-5,1000,10,1,50",
      "2026-10-03,A,s,a,5,100,200,1,50",
    ));
    expect(r.metrics).toHaveLength(1);
    expect(r.errors).toEqual([
      { row: 3, column: "date", message: "Date does not exist" },
      { row: 4, column: "spend", message: "Must be a non-negative number" },
      { row: 5, column: "clicks", message: "Clicks cannot exceed impressions" },
    ]);
  });

  it("sums breakdown rows of the same ad and day (e.g. one row per country)", () => {
    const r = parseCsv(csv("2026-10-01,A,S,A,1.10,10,1,0,5.05", "2026-10-01,a,S,A,2.20,20,2,1,0.10", "2026-10-01,a,S,A,0.05,5,0,0,0"));
    expect(r.errors).toEqual([]);
    expect(r.metrics).toHaveLength(1);
    expect(r.mergedRows).toBe(2);
    expect(r.metrics[0]).toMatchObject({ spend: 3.35, impressions: 35, clicks: 3, conversions: 1, revenue: 5.15, row: 2 });
  });

  it("rejects a row that is an exact copy of an earlier one instead of doubling it", () => {
    const r = parseCsv(csv("2026-10-01,A,S,A,1,10,1,0,0", "2026-10-01,a,S,A,1,10,1,0,0"));
    expect(r.metrics).toHaveLength(1);
    expect(r.mergedRows).toBe(0);
    expect(r.errors[0]).toMatchObject({ row: 3 });
    expect(r.errors[0]!.message).toContain("row 2");
  });

  it("ignores a currency code used as a column suffix (spend_usd, revenue_eur)", () => {
    const r = parseCsv(Buffer.from("date,campaign_id,impressions,clicks,conversions,spend_usd,revenue_eur\n2026-10-01,A,100,5,1,12.5,30"), { campaign: "campaign_id" });
    expect(r.errors).toEqual([]);
    expect(r.metrics[0]).toMatchObject({ spend: 12.5, revenue: 30 });
  });

  it("rejects a copy of any earlier breakdown row, not only of the first one", () => {
    const r = parseCsv(csv("2026-10-01,A,S,A,1,10,1,0,0", "2026-10-01,A,S,A,2,20,2,0,0", "2026-10-01,A,S,A,2,20,2,0,0"));
    expect(r.metrics[0]).toMatchObject({ spend: 3, impressions: 30 });
    expect(r.mergedRows).toBe(1);
    expect(r.errors).toEqual([{ row: 4, message: expect.stringContaining("identical to row 3") }]);
  });

  it("ad_set and ad are optional (default to (unassigned))", () => {
    const r = parseCsv(Buffer.from("date,campaign,spend,impressions,clicks,conversions,revenue\n2026-10-01,A,1,10,1,0,0"));
    expect(r.metrics[0]).toMatchObject({ adSetName: "(unassigned)", adName: "(unassigned)" });
  });

  it("recognizes the ; separator, BOM and decimal comma", () => {
    const r = parseCsv(Buffer.from("﻿date;campaign;spend;impressions;clicks;conversions;revenue\n2026-10-01;A;12,50;100;5;1;30,25"));
    expect(r.errors).toEqual([]);
    expect(r.metrics[0]).toMatchObject({ spend: 12.5, revenue: 30.25 });
  });

  it("supports column mapping", () => {
    const buf = Buffer.from("Day,Name,Cost,Views,Taps,Sales,Income\n2026-10-01,A,1,10,1,0,0");
    const r = parseCsv(buf, { date: "Day", campaign: "Name", spend: "Cost", impressions: "Views", clicks: "Taps", conversions: "Sales", revenue: "Income" });
    expect(r.metrics).toHaveLength(1);
  });

  it("throws a 400 listing the missing columns", () => {
    expect(() => parseCsv(Buffer.from("date,campaign\n2026-10-01,A"))).toThrow(/Missing required columns/);
  });
});

describe("parseCsv without a date column", () => {
  const NO_DATE = "campaign,spend,impressions,clicks,conversions,revenue";
  const file = (...lines: string[]) => Buffer.from([NO_DATE, ...lines].join("\n"));

  it("asks for a period when there is no date column", () => {
    expect(() => parseCsv(file("A,10,100,5,1,30"))).toThrow(/Missing required columns: date/);
  });

  it("spreads totals evenly over the period and keeps every total exact", () => {
    const r = parseCsv(file("A,100.01,1000,10,3,50.5"), {}, new Map(), { from: "2026-10-01", to: "2026-10-03" });
    expect(r.errors).toEqual([]);
    expect(r.spread).toEqual({ from: "2026-10-01", to: "2026-10-03", days: 3 });
    expect(r.metrics.map((m) => m.date)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    const sum = (k: "spend" | "impressions" | "clicks" | "conversions" | "revenue") => r.metrics.reduce((n, m) => n + m[k], 0);
    expect(sum("impressions")).toBe(1000);
    expect(sum("clicks")).toBe(10);
    expect(sum("conversions")).toBe(3);
    expect(Math.round(sum("spend") * 100)).toBe(10001);
    expect(Math.round(sum("revenue") * 100)).toBe(5050);
    expect(r.metrics.every((m) => m.clicks <= m.impressions)).toBe(true);
  });

  it("does not spread a file that has a date column", () => {
    const r = parseCsv(csv("2026-10-01,A,s,a,1,10,1,0,0"), {}, new Map(), { from: "2026-11-01", to: "2026-11-30" });
    expect(r.spread).toBeNull();
    expect(r.metrics).toHaveLength(1);
    expect(r.metrics[0]!.date).toBe("2026-10-01");
  });

  it("refuses a spread that would create too many rows", () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `C${i},1,10,1,0,0`);
    expect(() => parseCsv(file(...lines), {}, new Map(), { from: "2026-01-01", to: "2026-12-31" })).toThrow(/too many rows/);
  });
});
