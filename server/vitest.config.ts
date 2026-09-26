import { defineConfig } from "vitest/config";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/stocksense_test?schema=public";

export default defineConfig({
  test: {
    env: { DATABASE_URL: TEST_DATABASE_URL, JWT_SECRET: "test-secret", OTP_DEV_ECHO: "true" },
    globalSetup: "./tests/global-setup.ts",
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
