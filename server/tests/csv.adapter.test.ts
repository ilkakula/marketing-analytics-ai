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

  it("rejects a duplicate (same ad and day) within the same file", () => {
    const r = parseCsv(csv("2026-10-01,A,s,a,1,10,1,0,0", "2026-10-01,a,S,A,2,20,2,0,0"));
    expect(r.metrics).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ row: 3 });
    expect(r.errors[0]!.message).toContain("row 2");
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
