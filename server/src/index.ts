import { createApp } from "./app";
import { prisma } from "./db";
import { env } from "./env";

const server = createApp().listen(env.port, () => {
  console.log(`StockSense API listening on http://localhost:${env.port}`);
});

async function shutdown() {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
