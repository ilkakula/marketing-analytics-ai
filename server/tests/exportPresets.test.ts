import request from "supertest";
import { createApp } from "../src/app";
import { sequelize } from "../src/database/sequelize";
import { ImportMapping } from "../src/database/models";
import { cleanNumber, headerSignature, normalizeHeader, parseCsv } from "../src/modules/imports/csv.adapter";
import { registerUser, resetDb } from "./helpers";

const buf = (s: string) => Buffer.from(s);

describe("header normalization and aliases", () => {
  it("drops the currency in parentheses and punctuation", () => {
    expect(normalizeHeader("Amount spent (USD)")).toBe("amount_spent");
    expect(normalizeHeader("Amount spent (EUR)")).toBe("amount_spent");
    expect(normalizeHeader("Conv. value")).toBe("conv_value");
    expect(normalizeHeader("  Ad set name ")).toBe("ad_set_name");
  });

  it("detects a Meta Ads Manager export without any mapping", () => {
    const r = parseCsv(buf("Day,Campaign name,Ad set name,Ad name,Amount spent (EUR),Impressions,Link clicks,Results,Purchase conversion value\n2026-10-01,A,S,X,10,1000,20,2,60"));
    expect(r.errors).toEqual([]);
    expect(r.metrics[0]).toMatchObject({ campaignName: "A", adSetName: "S", adName: "X", spend: 10, clicks: 20, conversions: 2, revenue: 60 });
    expect(r.detected.kind).toBe("meta");
    expect(r.detected.mapping).toMatchObject({ date: "Day", spend: "Amount spent (EUR)", clicks: "Link clicks", revenue: "Purchase conversion value" });
  });

  it("detects a Google Ads export: title lines, ad groups, thousands separators, '--' and a Total row", () => {
    const csv = [
      "Campaign performance",
      "October 1, 2026 - October 3, 2026",
      "Day,Campaign,Ad group,Cost,Impressions,Clicks,Conversions,Conv. value",
      '2026-10-01,Brand,Core,"1,234.50","120,000",3400,12,"4,800.00"',
      "2026-10-02,Brand,Core,100,10000, --,0, --",
      "Total: Account,,,\"1,334.50\",\"130,000\",3400,12,\"4,800.00\"",
    ].join("\n");
    const r = parseCsv(buf(csv));
    expect(r.detected).toMatchObject({ kind: "google", headerRow: 3 });
    expect(r.errors).toEqual([]);
    expect(r.totalRows).toBe(2); // the Total row is not data
    expect(r.metrics[0]).toMatchObject({ adSetName: "Core", spend: 1234.5, impressions: 120000, revenue: 4800 });
    expect(r.metrics[1]).toMatchObject({ clicks: 0, revenue: 0 }); // "--" means no data
  });

  it("reports errors at the real line number of the file, even after title lines", () => {
    const r = parseCsv(buf("Report\nDay,Campaign,Cost,Impressions,Clicks,Conversions,Conv. value\n2026-10-01,A,10,100,5,1,5\nnot-a-date,A,10,100,5,1,5"));
    expect(r.errors).toEqual([{ row: 4, column: "date", message: "Date must be in YYYY-MM-DD format" }]); // one message per problem
  });

  it("prefers the field's own name, then aliases in priority order, and uses each column once", () => {
    const both = parseCsv(buf("date,campaign,cost,amount spent,impressions,clicks,link clicks,conversions,revenue\n2026-10-01,A,5,10,100,7,9,1,1"));
    expect(both.metrics[0]).toMatchObject({ spend: 10, clicks: 7 }); // amount_spent beats cost; clicks beats link_clicks
    const links = parseCsv(buf("date,campaign,spend,impressions,Clicks (all),Link clicks,conversions,revenue\n2026-10-01,A,5,100,30,20,1,1"));
    expect(links.metrics[0]!.clicks).toBe(20); // link_clicks is ahead of clicks_all
  });

  it("an explicit mapping wins over aliases", () => {
    const csv = "Day,Campaign,Cost,Other cost,Impressions,Clicks,Conversions,Revenue\n2026-10-01,A,5,99,100,1,1,1";
    expect(parseCsv(buf(csv)).metrics[0]!.spend).toBe(5);
    expect(parseCsv(buf(csv), { spend: "Other cost" }).metrics[0]!.spend).toBe(99);
    expect(parseCsv(buf(csv), { spend: "Other cost" }).detected.kind).toBe("custom");
  });

  it("reads UTF-16 and tab-separated files (Excel 'Unicode text')", () => {
    const text = "date\tcampaign\tspend\timpressions\tclicks\tconversions\trevenue\n2026-10-01\tA\t10\t100\t5\t1\t20";
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
    expect(parseCsv(utf16).metrics[0]).toMatchObject({ campaignName: "A", spend: 10 });
  });

  it("still lists the missing columns, with what it could detect", () => {
    try { parseCsv(buf("Day,Campaign name,Amount spent\n2026-10-01,A,5")); throw new Error("expected a throw"); }
    catch (e) {
      const d = (e as { details: { missing: string[]; detected: Record<string, string> } }).details;
      expect(d.missing).toEqual(["impressions", "clicks", "conversions", "revenue"]);
      expect(d.detected).toMatchObject({ date: "Day", campaign: "Campaign name", spend: "Amount spent" });
    }
  });
});

describe("cleanNumber", () => {
  it("handles symbols, thousands separators, decimal commas and no-data markers", () => {
    expect(cleanNumber("$1,234.50", false)).toBe("1234.50");
    expect(cleanNumber("EUR 12", false)).toBe("12");
    expect(cleanNumber("1.234,50", true)).toBe("1234.50");
    expect(cleanNumber("12,5", true)).toBe("12.5");
    expect(cleanNumber(" --", false)).toBe("0");
    expect(cleanNumber("1,234,567", false)).toBe("1234567");
  });
  it("leaves invalid values invalid (negative or text) so the row is reported", () => {
    expect(cleanNumber("-5", false)).toBe("-5");
    expect(cleanNumber("abc", false)).toBe("");
    expect(cleanNumber("12abc34", false)).toBe("12abc34");
  });
});

describe("header signature", () => {
  it("ignores column order, case and the currency in parentheses", () => {
    expect(headerSignature(["Day", "Cost (USD)", "Campaign"])).toBe(headerSignature(["campaign", "COST (EUR)", "day"]));
    expect(headerSignature(["Day", "Cost"])).not.toBe(headerSignature(["Day", "Cost", "Extra"]));
  });
});

describe("saved mappings", () => {
  const app = createApp();
  let token: string;
  const CUSTOM = (campaign: string) => `When,Promo,Money out,Views,Taps,Sales,Income\n2026-10-01,${campaign},10,1000,50,2,80`;
  const MAP = { date: "When", campaign: "Promo", spend: "Money out", impressions: "Views", clicks: "Taps", conversions: "Sales", revenue: "Income" };
  const upload = (csv: string, t = token, mapping?: object) => {
    const r = request(app).post("/api/imports/csv").set("Authorization", `Bearer ${t}`).attach("file", Buffer.from(csv), "d.csv");
    return mapping ? r.field("mapping", JSON.stringify(mapping)) : r;
  };
  beforeEach(async () => { await resetDb(); ({ token } = await registerUser(app, "a@x.com")); });
  afterAll(() => sequelize.close());

  it("remembers a hand-made mapping so the next file with the same columns needs none", async () => {
    expect((await upload(CUSTOM("First"))).status).toBe(400); // unknown layout: needs a mapping
    const first = await upload(CUSTOM("First"), token, MAP);
    expect(first.status).toBe(201);
    expect(first.body.detected).toMatchObject({ kind: "custom", mapping: { spend: "Money out" } });
    expect(await ImportMapping.count()).toBe(1);

    const second = await upload(CUSTOM("Second")); // same columns, no mapping
    expect(second.status).toBe(201);
    expect(second.body.detected.kind).toBe("saved");
    expect(second.body.rowsImported).toBe(1);
  });

  it("matches the layout regardless of column order", async () => {
    await upload(CUSTOM("First"), token, MAP);
    const reordered = "Income,Sales,Taps,Views,Money out,Promo,When\n80,2,50,1000,10,Reordered,2026-10-02";
    expect((await upload(reordered)).body.detected.kind).toBe("saved");
  });

  it("is per workspace: another workspace still needs its own mapping", async () => {
    await upload(CUSTOM("First"), token, MAP);
    const other = await registerUser(app, "b@x.com", "B");
    expect((await upload(CUSTOM("X"), other.token)).status).toBe(400);
  });

  it("a new explicit mapping replaces the saved one, and a failed import saves nothing", async () => {
    await upload(CUSTOM("First"), token, MAP);
    await upload(CUSTOM("Second"), token, { ...MAP, spend: "Income", revenue: "Money out" }); // swap the two columns
    const saved = await ImportMapping.findOne();
    expect(saved!.mapping).toMatchObject({ spend: "Income", revenue: "Money out" });
    expect(await ImportMapping.count()).toBe(1);

    await resetDb(); ({ token } = await registerUser(app, "a@x.com"));
    const bad = await upload(`When,Promo,Money out,Views,Taps,Sales,Income\nnot-a-date,A,1,1,1,1,1`, token, MAP);
    expect(bad.status).toBe(422);
    expect(await ImportMapping.count()).toBe(0);
  });

  it("known exports need no mapping and nothing is saved for them", async () => {
    const meta = "Day,Campaign name,Amount spent (USD),Impressions,Link clicks,Results,Purchase conversion value\n2026-10-01,A,10,1000,20,2,60";
    const res = await upload(meta);
    expect(res.status).toBe(201);
    expect(res.body.detected.kind).toBe("meta");
    expect(await ImportMapping.count()).toBe(0);
  });
});
