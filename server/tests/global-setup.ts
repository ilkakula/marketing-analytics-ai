// Once before all tests: apply the migrations to the test database.
export default async function globalSetup() {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ?? "postgres://spendlens:spendlens@localhost:5432/spendlens_test";
  process.env.JWT_SECRET = "test-secret-test-secret-test-secret-1234";
  // require (not import): env must be set BEFORE the config module is loaded.
  const { migrateUp } = require("../src/database/migrate") as typeof import("../src/database/migrate");
  const { sequelize } = require("../src/database/sequelize") as typeof import("../src/database/sequelize");
  await migrateUp();
  await sequelize.close();
}
