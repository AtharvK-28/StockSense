import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDatabase } from "./helpers";

let server: Server;
let base: string;

beforeAll(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
beforeEach(resetDatabase);
afterAll(async () => {
  server.close();
  await prisma.$disconnect();
});

async function post(path: string, body: unknown, cookie?: string) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json(), cookie: res.headers.get("set-cookie")?.split(";")[0] };
}

describe("auth", () => {
  it("signs up, protects routes, and logs in", async () => {
    const signup = await post("/auth/signup", { name: "Meena", email: "Meena@Test.dev", password: "secret123" });
    expect(signup.status).toBe(201);
    expect(signup.body.user.email).toBe("meena@test.dev");
    expect(signup.cookie).toMatch(/^ss_session=/);

    expect((await fetch(`${base}/dashboard`)).status).toBe(401);
    expect((await fetch(`${base}/dashboard`, { headers: { Cookie: signup.cookie! } })).status).toBe(200);

    expect((await post("/auth/login", { email: "meena@test.dev", password: "wrong-pass1" })).status).toBe(401);
    expect((await post("/auth/login", { email: "meena@test.dev", password: "secret123" })).status).toBe(200);
  });

  it("rejects weak passwords and duplicate emails", async () => {
    expect((await post("/auth/signup", { name: "A B", email: "a@test.dev", password: "short" })).status).toBe(400);
    await post("/auth/signup", { name: "A B", email: "a@test.dev", password: "secret123" });
    expect((await post("/auth/signup", { name: "A B", email: "a@test.dev", password: "secret123" })).status).toBe(409);
  });

  it("resets a password with a single-use OTP", async () => {
    await post("/auth/signup", { name: "Rakesh", email: "rakesh@test.dev", password: "secret123" });

    const unknown = await post("/auth/forgot-password", { email: "nobody@test.dev" });
    expect(unknown.status).toBe(200);
    expect(unknown.body.devOtp).toBeUndefined();

    const forgot = await post("/auth/forgot-password", { email: "rakesh@test.dev" });
    const code: string = forgot.body.devOtp;
    expect(code).toMatch(/^\d{6}$/);

    const wrong = code === "000000" ? "111111" : "000000";
    expect((await post("/auth/reset-password", { email: "rakesh@test.dev", code: wrong, password: "newpass123" })).status).toBe(400);
    expect((await post("/auth/reset-password", { email: "rakesh@test.dev", code, password: "newpass123" })).status).toBe(200);
    // Single use.
    expect((await post("/auth/reset-password", { email: "rakesh@test.dev", code, password: "another123" })).status).toBe(400);

    expect((await post("/auth/login", { email: "rakesh@test.dev", password: "newpass123" })).status).toBe(200);
    const stored = await prisma.otpCode.findFirstOrThrow();
    expect(stored.codeHash).not.toBe(code);
  });
});
