import bcrypt from "bcryptjs";
import { sequelize } from "./sequelize";
import { Campaign, DataSource, User, Workspace, WorkspaceMember } from "./models";
import { persistMetrics } from "../modules/imports/imports.service";
import { type AdMetric, toExternalId } from "../modules/imports/adMetric";

// Demo data with INTENTIONALLY planted problems, so the AI analyst has something to find:
//  - "Summer Sale - Broad": high spend, ROAS < 1 (losing money)
//  - "Video Views - Awareness": CPC jumps in the last 14 days
//  - "New Collection": conversions keep falling
//  - "Prospecting - Lookalike": spend x3.2 two days ago (runaway budget)
//  - "Brand Search": today conversions ~0 with normal spend (broken tracking)
//  - "Influencer Test": real spend and clicks, no conversions at all
//  - "Display - Banners": CTR far below the account average
// Deterministic (same seed = same data), so demos and tests are repeatable.
const DAYS = 90;
const EMAIL = "demo@spendlens.dev";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

interface Profile {
  name: string; dailySpend: number; cpm: number; ctr: number; cvr: number; aov: number;
  tweak?: (day: number, v: { cpm: number; ctr: number; cvr: number; spendMult: number }) => void; // day 0 = oldest
}
const PROFILES: Profile[] = [
  { name: "Brand Search", dailySpend: 220, cpm: 30, ctr: 0.06, cvr: 0.06, aov: 70,
    tweak: (d, v) => { if (d === DAYS - 1) v.cvr *= 0.04; } },
  { name: "Prospecting - Lookalike", dailySpend: 480, cpm: 9, ctr: 0.014, cvr: 0.03, aov: 62,
    tweak: (d, v) => { if (d === DAYS - 3) v.spendMult = 3.2; } },
  { name: "Retargeting - Cart", dailySpend: 140, cpm: 35, ctr: 0.03, cvr: 0.08, aov: 85 },
  { name: "Summer Sale - Broad", dailySpend: 620, cpm: 8, ctr: 0.011, cvr: 0.012, aov: 48 },
  { name: "Video Views - Awareness", dailySpend: 260, cpm: 5, ctr: 0.012, cvr: 0.01, aov: 55,
    tweak: (d, v) => { if (d >= DAYS - 14) { v.ctr *= 0.55; v.cpm *= 1.15; } } }, // CPC ≈ cpm/(1000*ctr) grows
  { name: "Influencer Test", dailySpend: 140, cpm: 12, ctr: 0.012, cvr: 0, aov: 0 },
  { name: "Display - Banners", dailySpend: 150, cpm: 3, ctr: 0.0012, cvr: 0.08, aov: 100 },
  { name: "New Collection", dailySpend: 300, cpm: 10, ctr: 0.018, cvr: 0.03, aov: 75,
    tweak: (d, v) => { if (d >= DAYS - 28) v.cvr *= 1 - ((d - (DAYS - 28)) / 28) * 0.6; } }, // drops by up to 60%
];

async function main() {
  const rand = rng(42);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  await sequelize.transaction(async (t) => {
    const [user] = await User.findOrCreate({
      where: { email: EMAIL },
      defaults: { email: EMAIL, name: "Demo", passwordHash: await bcrypt.hash("demo12345", 12) },
      transaction: t,
    });
    let membership = await WorkspaceMember.findOne({ where: { userId: user.id }, transaction: t });
    if (!membership) {
      const ws = await Workspace.create({ name: "Demo Agency" }, { transaction: t });
      membership = await WorkspaceMember.create({ userId: user.id, workspaceId: ws.id, role: "owner" }, { transaction: t });
    }
    const workspaceId = membership.workspaceId;

    // Clear old demo data (FK ON DELETE CASCADE removes ad sets, ads and metrics).
    await Campaign.destroy({ where: { workspaceId }, transaction: t });
    await DataSource.destroy({ where: { workspaceId, provider: "csv" }, transaction: t });

    const metrics: AdMetric[] = [];
    for (const p of PROFILES) {
      for (let day = 0; day < DAYS; day++) {
        const date = new Date(today);
        date.setUTCDate(today.getUTCDate() - (DAYS - 1 - day));
        const weekend = [0, 6].includes(date.getUTCDay()) ? 1.15 : 1;
        const trend = 1 + (day / DAYS) * 0.08; // gentle budget growth
        for (const setName of ["Women 25-44", "Men 25-44"]) {
          for (const adName of ["Creative A", "Creative B"]) {
            const v = { cpm: p.cpm, ctr: p.ctr, cvr: p.cvr, spendMult: 1 };
            p.tweak?.(day, v);
            const noise = () => 0.85 + rand() * 0.3;
            const spend = (p.dailySpend / 4) * weekend * trend * v.spendMult * noise();
            const impressions = Math.round((spend / (v.cpm * noise())) * 1000);
            const clicks = Math.min(impressions, Math.round(impressions * v.ctr * noise()));
            const conversions = Math.round(clicks * v.cvr * noise());
            const revenue = conversions * p.aov * noise();
            metrics.push({
              date: date.toISOString().slice(0, 10),
              campaignExternalId: toExternalId(p.name), campaignName: p.name,
              adSetExternalId: toExternalId(setName), adSetName: setName,
              adExternalId: toExternalId(adName), adName,
              spend: Math.round(spend * 100) / 100, impressions, clicks, conversions,
              revenue: Math.round(revenue * 100) / 100,
            });
          }
        }
      }
    }
    await persistMetrics(workspaceId, metrics, t);
    console.log(`Seed complete: ${metrics.length} metric rows, ${PROFILES.length} campaigns, ${DAYS} days.`);
    console.log(`Login: ${EMAIL} / demo12345`);
  });
}

main().then(() => sequelize.close()).catch((e) => { console.error(e); process.exit(1); });
