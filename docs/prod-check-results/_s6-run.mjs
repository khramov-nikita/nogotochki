import { chromium } from "playwright";

const base = "https://nogotochki-test.ru";
const email = "s6-ratelimit-throwaway-1790019149737@example.invalid";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const loginResponses = [];
page.on("response", async (res) => {
  if (res.url().includes("/api/auth/login") && res.request().method() === "POST") {
    let body = null;
    try { body = await res.json(); } catch {}
    loginResponses.push({ status: res.status(), body });
  }
});

await page.goto(base + "/auth.html", { waitUntil: "networkidle" });
await page.fill("#email", email);
await page.fill("#password", "wrong-ui-check");
await page.click("#login-form button[type='submit']");
await page.waitForTimeout(2000);
const alertVisible = await page.locator("#form-alert.is-visible").isVisible().catch(() => false);
const alertText = await page.locator("#form-alert p").textContent().catch(() => "");
console.log(JSON.stringify({
  url: page.url(),
  alertVisible,
  alertText: (alertText || "").trim(),
  loginResponses
}, null, 2));
await browser.close();
