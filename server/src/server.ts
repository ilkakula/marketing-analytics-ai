import { createApp } from "./app";
import { env } from "./config/env";
import { sequelize } from "./database/sequelize";

async function main() {
  await sequelize.authenticate();
  const server = createApp().listen(env.PORT, () =>
    console.log(`Spendlens API listening on http://localhost:${env.PORT}`),
  );

  const shutdown = async () => {
    server.close();
    await sequelize.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Server failed to start:", err);
  process.exit(1);
});
