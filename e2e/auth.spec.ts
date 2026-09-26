import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test.describe.configure({ mode: "serial" });

test("a wrong password shows the mockup's message", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Login ID").fill("manager");
  await page.getByLabel("Password", { exact: true }).fill("Wrong@1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Invalid Login Id or Password")).toBeVisible();
});

test("logs in with a Login ID and lands on the dashboard", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening), Rakesh/ })).toBeVisible();
  await expect(page.getByText("to receive")).toBeVisible();
});

test("sign-up enforces the rules and new accounts join as staff", async ({ page }) => {
  await page.goto("/signup");
  const submit = page.getByRole("button", { name: "Sign up" });
  await page.getByLabel("Enter Login ID").fill("abc");
  await page.getByLabel("Enter Email ID").fill("newbie@test.dev");
  await page.getByLabel("Enter Password", { exact: true }).fill("weakpass");
  await page.getByLabel("Re-Enter Password").fill("weakpass");
  await expect(submit).toBeDisabled();

  await page.getByLabel("Enter Login ID").fill("newbie01");
  await page.getByLabel("Enter Password", { exact: true }).fill("Strong@123");
  await page.getByLabel("Re-Enter Password").fill("Strong@123");
  await submit.click();
  await expect(page).toHaveURL("/");
  await expect(page.getByText("Warehouse staff").first()).toBeVisible();
});

test("password reset with a one-time code", async ({ page }) => {
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill("newbie@test.dev"); // created by the sign-up test above
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByRole("button", { name: "Fill" }).click();
  await page.getByLabel("New password", { exact: true }).fill("Changed@123");
  await page.getByLabel("Confirm new password").fill("Changed@123");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByText("Password updated")).toBeVisible();
  await login(page, "newbie01", "Changed@123");
});
