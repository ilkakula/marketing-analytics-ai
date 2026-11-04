import { Umzug, SequelizeStorage } from "umzug";
import { QueryInterface } from "sequelize";
import path from "node:path";
import { sequelize } from "./sequelize";

// A migration's name must NOT depend on its extension: in development .ts files run (tsx),
// while in the Docker image compiled .js files run. With the extension in the name the same
// migration would look "new" and try to run again against an existing schema.
// Explicit name: the default depends on the `underscored` option of the Sequelize config, so we do not leave it implicit.
const META_TABLE = "sequelize_meta";

const baseName = (n: string) => n.replace(/\.(ts|js)$/, "");

export const umzug = new Umzug<QueryInterface>({
  migrations: {
    glob: path.join(__dirname, "migrations", "*.{ts,js}"),
    resolve: ({ name, path: file, context }) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const m = require(file!) as { up: (a: { context: QueryInterface }) => Promise<void>; down: (a: { context: QueryInterface }) => Promise<void> };
      return { name: baseName(name), up: () => m.up({ context }), down: () => m.down({ context }) };
    },
  },
  context: sequelize.getQueryInterface(),
  storage: new SequelizeStorage({ sequelize, tableName: META_TABLE }),
  logger: console,
});

/** One-time (idempotent) normalization of records from when the extension was part of the name. */
async function normalizeLegacyNames() {
  const [rows] = await sequelize.query(`SELECT to_regclass('${META_TABLE}') AS t`);
  if (!(rows as Array<{ t: string | null }>)[0]?.t) return;
  await sequelize.query(`
    INSERT INTO ${META_TABLE}(name)
      SELECT DISTINCT regexp_replace(name, '\\.(ts|js)$', '') FROM ${META_TABLE} WHERE name ~ '\\.(ts|js)$'
      ON CONFLICT DO NOTHING;
    DELETE FROM ${META_TABLE} WHERE name ~ '\\.(ts|js)$';`);
}

export async function migrateUp() {
  await normalizeLegacyNames();
  return umzug.up();
}

if (require.main === module) {
  const direction = process.argv[2] === "down" ? "down" : "up";
  (direction === "up" ? migrateUp() : umzug.down())
    .then(() => sequelize.close())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
