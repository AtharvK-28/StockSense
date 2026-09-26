import { execSync } from "node:child_process";
import { E2E_DATABASE_URL } from "../playwright.config";

/** Fresh, seeded e2e database before every run. */
export default function globalSetup() {
  const env = { ...process.env, DATABASE_URL: E2E_DATABASE_URL, JWT_SECRET: "e2e-secret" };
  const run = (cmd: string) => execSync(cmd, { cwd: "server", env, stdio: "inherit" });
  run("npx prisma migrate deploy");
  run("npx tsx prisma/clear.ts");
  run("npx tsx prisma/seed.ts");
}
