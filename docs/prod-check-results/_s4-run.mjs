import { chromium } from "playwright";
import { writeFileSync } from "fs";

const PRIMARY = "https://nogotochki-test.ru";
const FALLBACK = "http://159.194.227.249:3000";
const ADMIN_EMAIL = "admin@nogotochki.test";
const ADMIN_PASS = "DevAdmin123!";
const CLIENT_PASS = process.env.S4_PASS || "DevClient123!";
// Prefer reuse of earlier prod-check accounts when register is rate-limited.
const CLIENT_EMAIL =
  process.env.S4_EMAIL || "c5probe_1790018461@nogotochki.test";
const FALLBACK_EMAILS = [
  "prodcheck-c1-1790018326@example.com",
  "c5probe_1790018461@nogotochki.test",
];

const evidence = {
  startedAt: new Date().toISOString(),
  clientEmail: CLIENT_EMAIL,
  base: null,
  steps: [],
  clientPart: null,
  adminPart: null,
  overall: null,
};

function log(msg, data) {
  const row = { msg, ...(data || {}) };
  evidence.steps.push(row);
  console.log(JSON.stringify(row));
}

async function pickBase(request) {
  for (const url of [PRIMARY, FALLBACK]) {
    try {
      const res = await request.get(url, { timeout: 15000 });
      log("base-probe", { url, status: res.status() });
      if (res.ok()) return url;
    } catch (e) {
      log("base-probe-fail", { url, error: String(e.message || e) });
    }
  }
  throw new Error("Neither primary nor fallback base reachable");
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: "ru-RU",
  timezoneId: "Europe/Moscow",
  ignoreHTTPSErrors: true,
});
const page = await context.newPage();

try {
  const base = await pickBase(context.request);
  evidence.base = base;

  // --- Client half: login existing account (register often rate-limited on prod) ---
  const emailsToTry = [CLIENT_EMAIL, ...FALLBACK_EMAILS.filter((e) => e !== CLIENT_EMAIL)];
  let loggedInEmail = null;

  for (const email of emailsToTry) {
    await page.goto(`${base}/auth.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.fill('input[name="email"], #email, input[type="email"]', email);
    await page.fill('input[name="password"], #password', CLIENT_PASS);
    const loginPromise = page.waitForResponse(
      (r) => r.url().includes("/api/auth/login") && r.request().method() === "POST",
      { timeout: 30000 },
    );
    await page.click('button[type="submit"], input[type="submit"]');
    const loginResp = await loginPromise;
    const loginStatus = loginResp.status();
    log("login-attempt", { email, status: loginStatus });
    if (loginResp.ok()) {
      loggedInEmail = email;
      evidence.clientEmail = email;
      break;
    }
    if (loginStatus === 429) {
      log("login-rate-limited", { email });
      // brief pause then try next / retry once
      await page.waitForTimeout(5000);
    }
  }

  if (!loggedInEmail) {
    // Last resort: try register with unique email
    const fresh = `prodcheck-s4-${Date.now()}@example.com`;
    await page.goto(`${base}/register.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.fill('input[name="email"], #email, input[type="email"]', fresh);
    await page.fill('input[name="password"], #password', CLIENT_PASS);
    const confirm = page.locator('input[name="password_confirmation"], #password_confirmation');
    if (await confirm.count()) await confirm.fill(CLIENT_PASS);
    const regPromise = page.waitForResponse(
      (r) => r.url().includes("/api/auth/register") && r.request().method() === "POST",
      { timeout: 30000 },
    );
    await page.click('button[type="submit"], input[type="submit"]');
    const regResp = await regPromise;
    log("register-fallback", { status: regResp.status(), email: fresh });
    if (!regResp.ok()) {
      throw new Error(`No usable client session (login+register failed): ${regResp.status()}`);
    }
    loggedInEmail = fresh;
    evidence.clientEmail = fresh;
  }

  await page.waitForURL(/cabinet\.html/, { timeout: 30000 });
  // Ensure we are on cabinet (login may land elsewhere)
  if (!/cabinet\.html/.test(page.url())) {
    await page.goto(`${base}/cabinet.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
  }
  const cabinetUrl1 = page.url();
  const cabinetTitle = await page.title();
  const h1 = (await page.locator("h1").first().innerText().catch(() => "")).trim();
  const emptyText = await page.locator("body").innerText();
  const hasEmpty = /В кабинете пока нет записей/i.test(emptyText);
  const cookiesAfterLogin = await context.cookies();
  const sessionCookie = cookiesAfterLogin.find((c) => c.name === "session");
  log("cabinet-after-login", {
    url: cabinetUrl1,
    title: cabinetTitle,
    h1,
    hasEmpty,
    email: loggedInEmail,
    session: sessionCookie
      ? { secure: sessionCookie.secure, httpOnly: sessionCookie.httpOnly, sameSite: sessionCookie.sameSite }
      : null,
  });

  // Logout from header
  const logoutBtn = page.locator("button.header-logout, #logout-btn").first();
  await logoutBtn.waitFor({ state: "visible", timeout: 15000 });
  const logoutPromise = page.waitForResponse(
    (r) => r.url().includes("/api/auth/logout") && r.request().method() === "POST",
    { timeout: 20000 },
  );
  await logoutBtn.click();
  const logoutResp = await logoutPromise.catch(() => null);
  log("logout", {
    status: logoutResp?.status(),
    ok: logoutResp?.ok(),
  });

  await page.waitForURL(/index\.html|\/$/, { timeout: 20000 });
  const afterLogoutUrl = page.url();
  const headerText = await page.locator("header, .site-header, .header").first().innerText().catch(() => "");
  const bodyAfter = await page.locator("body").innerText();
  const hasLoginLink = /Войти/i.test(headerText) || /Войти/i.test(bodyAfter);
  const hasLogout = /Выйти/i.test(headerText);
  const cookiesAfterLogout = await context.cookies();
  const sessionAfter = cookiesAfterLogout.find((c) => c.name === "session");
  log("after-logout", {
    url: afterLogoutUrl,
    hasLoginLink,
    hasLogout,
    sessionPresent: Boolean(sessionAfter?.value),
    sessionValueLen: sessionAfter?.value?.length || 0,
  });

  // me should be 401
  const meAfter = await context.request.get(`${base}/api/auth/me`);
  log("me-after-logout", { status: meAfter.status(), body: await meAfter.text().catch(() => "") });

  // Revisit cabinet
  await page.goto(`${base}/cabinet.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForURL(/auth\.html/, { timeout: 20000 });
  const revisitUrl = page.url();
  const revisitBody = await page.locator("body").innerText();
  const hasAuthForm = /Вход/i.test(revisitBody) || (await page.locator('input[type="password"]').count()) > 0;
  const hasOthersAppointments =
    /Ожидает предоплату|Подтверждена|Перенесена/i.test(revisitBody) &&
    !/auth\.html/i.test(revisitUrl);
  const nextOk = /next=cabinet\.html|next=.*cabinet/i.test(revisitUrl);
  log("revisit-cabinet", {
    url: revisitUrl,
    hasAuthForm,
    hasOthersAppointments,
    nextOk,
  });

  const clientPass =
    hasLoginLink &&
    !hasLogout &&
    meAfter.status() === 401 &&
    /auth\.html/.test(revisitUrl) &&
    nextOk &&
    hasAuthForm &&
    !hasOthersAppointments;

  evidence.clientPart = {
    status: clientPass ? "pass" : "fail",
    afterLogoutUrl,
    hasLoginLink,
    meStatus: meAfter.status(),
    revisitUrl,
    nextOk,
    hasOthersAppointments,
  };

  // --- Admin half ---
  const adminLogin = await context.request.post(`${base}/api/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASS },
  });
  const adminLoginBody = await adminLogin.text();
  log("admin-login-api", { status: adminLogin.status(), body: adminLoginBody.slice(0, 300) });

  if (adminLogin.status() === 401 || adminLogin.status() === 403) {
    evidence.adminPart = {
      status: "blocked",
      reason: "seed admin missing / login failed",
      loginStatus: adminLogin.status(),
    };
  } else if (adminLogin.ok()) {
    // Full admin UI logout path
    await page.goto(`${base}/auth.html`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="email"], #email, input[type="email"]', ADMIN_EMAIL);
    await page.fill('input[name="password"], #password', ADMIN_PASS);
    await page.click('button[type="submit"], input[type="submit"]');
    await page.waitForTimeout(2000);
    await page.goto(`${base}/admin`, { waitUntil: "domcontentloaded", timeout: 30000 });
    const adminUrl1 = page.url();
    const adminH1 = (await page.locator("h1").first().innerText().catch(() => "")).trim();
    log("admin-open", { url: adminUrl1, h1: adminH1 });

    const adminLogout = page.locator("button.header-logout").first();
    await adminLogout.click();
    await page.waitForURL(/index\.html|\/$/, { timeout: 20000 });
    await page.goto(`${base}/admin`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForURL(/auth\.html/, { timeout: 20000 });
    const adminRevisit = page.url();
    log("admin-revisit", { url: adminRevisit });
    evidence.adminPart = {
      status: /auth\.html/.test(adminRevisit) ? "pass" : "fail",
      revisitUrl: adminRevisit,
    };
  } else {
    evidence.adminPart = {
      status: "blocked",
      reason: `unexpected login status ${adminLogin.status()}`,
      loginStatus: adminLogin.status(),
    };
  }

  // Overall: client pass + admin blocked => partial pass documented as pass (cabinet) / blocked (admin)
  if (evidence.clientPart.status === "pass" && evidence.adminPart.status === "blocked") {
    evidence.overall = "pass (cabinet); admin blocked";
  } else if (evidence.clientPart.status === "pass" && evidence.adminPart.status === "pass") {
    evidence.overall = "pass";
  } else if (evidence.clientPart.status === "fail") {
    evidence.overall = "fail";
  } else {
    evidence.overall = `${evidence.clientPart.status} / ${evidence.adminPart.status}`;
  }

  evidence.finishedAt = new Date().toISOString();
  log("done", { overall: evidence.overall, client: evidence.clientPart, admin: evidence.adminPart });
} catch (e) {
  evidence.error = String(e.stack || e);
  evidence.overall = "error";
  console.error(e);
  process.exitCode = 1;
} finally {
  const out = "docs/prod-check-results/_s4-evidence.json";
  writeFileSync(out, JSON.stringify(evidence, null, 2), "utf8");
  console.log("wrote", out);
  await browser.close();
}
