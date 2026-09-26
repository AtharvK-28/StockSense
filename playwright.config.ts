import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the production build (API + web on one port) and a dedicated
 * database, so demo data is never touched.
 *
 *   npm run e2e                 locally (uses installed Microsoft Edge by default)
 *   PW_CHANNEL= npm run e2e     use Playwright's bundled Chromium (CI)
 */
const PORT = Number(process.env.E2E_PORT ?? 4100);
export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/stocksense_e2e?schema=public";
const channel = process.env.PW_CHANNEL ?? (process.env.CI ? undefined : "msedge");

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 45_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: channel || undefined,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: channel || undefined, viewport: { width: 1440, height: 900 } }, testIgnore: /mobile\.spec/ },
    { name: "mobile", use: { ...devices["Pixel 7"], channel: channel || undefined }, testMatch: /mobile\.spec/ },
  ],
  webServer: {
    command: "npm run build && npm start",
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      PORT: String(PORT),
      DATABASE_URL: E2E_DATABASE_URL,
      JWT_SECRET: "e2e-secret",
      OTP_DEV_ECHO: "true",
      CLIENT_ORIGIN: `http://localhost:${PORT}`,
    },
  },
});
