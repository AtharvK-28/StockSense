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
    const signup = await post("/auth/signup", { loginId: "Meena01", email: "Meena@Test.dev", password: "Secret@123" });
    expect(signup.status).toBe(201);
    expect(signup.body.user.email).toBe("meena@test.dev");
    expect(signup.body.user.loginId).toBe("meena01");
    expect(signup.cookie).toMatch(/^ss_session=/);

    expect((await fetch(`${base}/dashboard`)).status).toBe(401);
    expect((await fetch(`${base}/dashboard`, { headers: { Cookie: signup.cookie! } })).status).toBe(200);

    const wrong = await post("/auth/login", { login: "meena01", password: "Wrong@1234" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toBe("Invalid Login Id or Password");
    expect((await post("/auth/login", { login: "meena01", password: "Secret@123" })).status).toBe(200);
    expect((await post("/auth/login", { login: "meena@test.dev", password: "Secret@123" })).status).toBe(200);
  });

  it("enforces Login ID and password rules and uniqueness", async () => {
    const weak = ["secret123", "Secret123", "secret@123", "Sec@1234"]; // no upper / no special / no upper / too short
    for (const password of weak) {
      expect((await post("/auth/signup", { loginId: "userone", email: "a@test.dev", password })).status).toBe(400);
    }
    expect((await post("/auth/signup", { loginId: "short", email: "a@test.dev", password: "Secret@123" })).status).toBe(400);
    expect((await post("/auth/signup", { loginId: "waytoolonglogin", email: "a@test.dev", password: "Secret@123" })).status).toBe(400);
    expect((await post("/auth/signup", { loginId: "userone", email: "a@test.dev", password: "Secret@123" })).status).toBe(201);
    const dupLogin = await post("/auth/signup", { loginId: "UserOne", email: "b@test.dev", password: "Secret@123" });
    expect(dupLogin.status).toBe(409);
    expect(dupLogin.body.error).toMatch(/Login ID/);
    expect((await post("/auth/signup", { loginId: "usertwo", email: "a@test.dev", password: "Secret@123" })).status).toBe(409);
  });

  it("locks login after 5 failed attempts", async () => {
    await post("/auth/signup", { loginId: "lockme1", email: "lock@test.dev", password: "Secret@123" });
    for (let i = 0; i < 5; i++) {
      expect((await post("/auth/login", { login: "lockme1", password: "Wrong@1234" })).status).toBe(401);
    }
    const locked = await post("/auth/login", { login: "lockme1", password: "Secret@123" });
    expect(locked.status).toBe(429);
    expect(locked.body.error).toMatch(/Too many failed attempts/);
  });

  it("resets a password with a single-use OTP", async () => {
    await post("/auth/signup", { loginId: "rakesh01", email: "rakesh@test.dev", password: "Secret@123" });

    const unknown = await post("/auth/forgot-password", { email: "nobody@test.dev" });
    expect(unknown.status).toBe(200);
    expect(unknown.body.devOtp).toBeUndefined();

    const forgot = await post("/auth/forgot-password", { email: "rakesh@test.dev" });
    const code: string = forgot.body.devOtp;
    expect(code).toMatch(/^\d{6}$/);

    const wrong = code === "000000" ? "111111" : "000000";
    expect((await post("/auth/reset-password", { email: "rakesh@test.dev", code: wrong, password: "NewPass@123" })).status).toBe(400);
    expect((await post("/auth/reset-password", { email: "rakesh@test.dev", code, password: "NewPass@123" })).status).toBe(200);
    // Single use.
    expect((await post("/auth/reset-password", { email: "rakesh@test.dev", code, password: "Another@123" })).status).toBe(400);

    expect((await post("/auth/login", { login: "rakesh01", password: "NewPass@123" })).status).toBe(200);
    const stored = await prisma.otpCode.findFirstOrThrow();
    expect(stored.codeHash).not.toBe(code);
  });
});
