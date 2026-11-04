import type { QueryInterface } from "sequelize";

// citext: case-insensitive text, used for email so that "Ana@x.com" and "ana@x.com"
// are the same user.
export const up = async ({ context: qi }: { context: QueryInterface }) => {
  await qi.sequelize.query('CREATE EXTENSION IF NOT EXISTS "citext"');
};

export const down = async ({ context: qi }: { context: QueryInterface }) => {
  await qi.sequelize.query('DROP EXTENSION IF EXISTS "citext"');
};
