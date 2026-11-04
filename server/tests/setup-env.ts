// Runs before every test file, before config/env.ts is loaded.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://spendlens:spendlens@localhost:5432/spendlens_test";
process.env.JWT_SECRET = "test-secret-test-secret-test-secret-1234";
