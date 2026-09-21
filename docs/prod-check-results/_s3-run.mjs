import { chromium } from "playwright";
import { writeFileSync } from "fs";

const BASE = process.env.S3_BASE || "https://nogotochki-test.ru";
const PASS = "DevClient123!";
const ts = Date.now();
const EMAIL_A = `prodcheck-s3a-${ts}@example.com`;
const EMAIL_B = `prodcheck-s3b-${ts}@example.com`;

const evidence = {
  base: BASE,
  startedAt: new Date().toISOString(),
  emailA: EMAIL_A,
  emailB: EMAIL_B,
  steps: [],
  status: "fail",
  ok: false,
};

function log(msg, data) {
  const row = { msg, ...(data || {}) };
  evidence.steps.push(row);
  console.log(JSON.stringify(row));
}

async function register(page, email) {
  await page.goto(`${BASE}/register.html`, { waitUntil: "networkidle", timeout: 60000 });
  await page.fill("#email", email);
  await page.fill("#password", PASS);
  const confirm = page.locator(
    "#password_confirmation, #password-confirm, input[name='password_confirmation']",
  );
  if ((await confirm.count()) > 0) await confirm.first().fill(PASS);
  const regPromise = page.waitForResponse(
    (r) => r.url().includes("/api/auth/register") && r.request().method() === "POST",
    { timeout: 30000 },
  );
  await page.locator('button[type="submit"]').click();
  const regResp = await regPromise;
  const regJson = await regResp.json().catch(() => null);
  if (!regResp.ok()) throw new Error(`register ${email} failed: ${JSON.stringify(regJson)}`);
  await page.waitForURL(/cabinet\.html/, { timeout: 30000 });
  log("register", { email, clientId: regJson?.client?.id, status: regResp.status() });
}

async function pickDayAndSlot(page, { preferStartsAt = null } = {}) {
  await page.waitForSelector("#calendar-grid button, .calendar-grid button", { timeout: 30000 });
  await page.waitForTimeout(1200);
  const dayButtons = page.locator("#calendar-grid button:not([disabled])");
  const dayCount = await dayButtons.count();
  log("days-available", { dayCount, preferStartsAt });

  for (let i = 0; i < Math.min(dayCount, 21); i++) {
    await dayButtons.nth(i).click();
    await page.waitForTimeout(1100);
    const slots = page.locator(".time-slot:not([disabled])");
    const sc = await slots.count();
    if (sc === 0) continue;

    let target = slots.first();
    let slotText = (await target.innerText()).trim();

    if (preferStartsAt) {
      // Match visible HH:MM in Europe/Moscow (studio TZ), not host local time
      const want = new Intl.DateTimeFormat("ru-RU", {
        timeZone: "Europe/Moscow",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(preferStartsAt));
      let found = false;
      for (let s = 0; s < sc; s++) {
        const t = (await slots.nth(s).innerText()).trim();
        if (t.includes(want) || t.startsWith(want)) {
          target = slots.nth(s);
          slotText = t;
          found = true;
          break;
        }
      }
      if (!found) continue;
    }

    const holdPromise = page
      .waitForResponse(
        (r) => r.url().includes("/api/holds") && r.request().method() === "POST",
        { timeout: 20000 },
      )
      .catch(() => null);
    await target.click();
    const holdResp = await holdPromise;
    await page.waitForTimeout(900);
    const timerVisible = await page.locator("#hold-timer").isVisible().catch(() => false);
    const nextEnabled = !(await page.locator("#next-btn").isDisabled());
    let holdBody = null;
    if (holdResp?.ok()) holdBody = await holdResp.json();
    log("slot-attempt", {
      i,
      slotText,
      timerVisible,
      nextEnabled,
      holdStatus: holdResp?.status(),
      starts_at: holdBody?.hold?.starts_at,
      expires_at: holdBody?.hold?.expires_at,
    });
    if (timerVisible && nextEnabled && holdResp?.ok()) return holdBody;
    if (preferStartsAt && holdResp && !holdResp.ok()) {
      const err = await holdResp.json().catch(() => null);
      throw new Error(`B could not hold preferred slot: ${JSON.stringify(err)}`);
    }
  }
  throw new Error("Could not create live hold on step 3");
}

async function goToReview(page, label) {
  await page.evaluate(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  await page.goto(`${BASE}/booking.html`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector("#services-main input[type=checkbox]", { timeout: 30000 });
  await page.locator("#services-main input[type=checkbox]").first().check();
  await page.waitForTimeout(400);
  if (await page.locator("#next-btn").isDisabled()) throw new Error(`${label}: next disabled step1`);
  await page.locator("#next-btn").click();
  await page.waitForURL(/booking-master/, { timeout: 30000 });

  await page.waitForTimeout(800);
  const radios = page.locator('input[name="master_id"]:not([disabled])');
  if ((await radios.count()) === 0) throw new Error(`${label}: no masters`);
  await radios.first().check({ force: true });
  await page.waitForTimeout(300);
  await page.locator("#next-btn").click();
  await page.waitForURL(/booking-datetime/, { timeout: 30000 });
  log(`${label}-to-datetime`, { url: page.url() });
}

const browser = await chromium.launch({ headless: true });
const ctxA = await browser.newContext({
  locale: "ru-RU",
  timezoneId: "Europe/Moscow",
  ignoreHTTPSErrors: true,
});
const ctxB = await browser.newContext({
  locale: "ru-RU",
  timezoneId: "Europe/Moscow",
  ignoreHTTPSErrors: true,
});
const pageA = await ctxA.newPage();
const pageB = await ctxB.newPage();

try {
  await pageA.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  log("landing", { url: pageA.url() });

  await register(pageA, EMAIL_A);
  await register(pageB, EMAIL_B);

  // --- Window A: hold → review ---
  await goToReview(pageA, "A");
  const holdA = await pickDayAndSlot(pageA);
  const startsAt = holdA.hold.starts_at;
  const holdTokenA = holdA.hold.hold_token;
  const masterId = holdA.hold.master?.id;
  const serviceIds = (holdA.hold.services || []).map((s) => s.id);

  await pageA.locator("#next-btn").click();
  await pageA.waitForURL(/booking-review/, { timeout: 30000 });
  await pageA.waitForTimeout(1200);
  const confirmA = pageA.locator("#confirm-btn");
  const confirmDisabledA = await confirmA.isDisabled();
  log("A-on-review", {
    url: pageA.url(),
    confirmDisabled: confirmDisabledA,
    starts_at: startsAt,
    masterId,
    serviceIds,
    hold_token_prefix: holdTokenA?.slice(0, 12),
    expires_at: holdA.hold.expires_at,
  });
  if (confirmDisabledA) throw new Error("A confirm disabled on review");

  // Free the slot for B while A keeps hold_token in page memory (simulates expired/purged hold
  // so another client can occupy the slot — core of S3 without waiting full reserve_minutes).
  const delResp = await pageA.request.fetch(`${BASE}/api/holds/${holdTokenA}`, { method: "DELETE" });
  const delJson = await delResp.json().catch(() => null);
  log("A-hold-released", { status: delResp.status(), body: delJson });
  if (!delResp.ok() && delResp.status() !== 409) {
    throw new Error(`DELETE hold A failed: ${delResp.status()} ${JSON.stringify(delJson)}`);
  }

  // Verify A still has token in JS state (review page not refreshed)
  const tokenStillInState = await pageA.evaluate(() => {
    try {
      const draft = JSON.parse(sessionStorage.getItem("bookingDraft") || localStorage.getItem("bookingDraft") || "{}");
      return Boolean(draft.holdToken || draft.hold_token);
    } catch {
      return false;
    }
  });
  log("A-token-still-present", { tokenStillInState });

  // --- Window B: take same slot → confirm to Done ---
  await goToReview(pageB, "B");
  const holdB = await pickDayAndSlot(pageB, { preferStartsAt: startsAt });
  if (holdB.hold.starts_at !== startsAt) {
    throw new Error(`B held different slot: ${holdB.hold.starts_at} vs ${startsAt}`);
  }
  await pageB.locator("#next-btn").click();
  await pageB.waitForURL(/booking-review/, { timeout: 30000 });
  await pageB.waitForTimeout(800);

  const createBPromise = pageB.waitForResponse(
    (r) => r.url().includes("/api/appointments") && r.request().method() === "POST",
    { timeout: 45000 },
  );
  await pageB.locator("#confirm-btn").click();
  const createBResp = await createBPromise;
  const createBJson = await createBResp.json().catch(() => null);
  log("B-confirm-api", {
    status: createBResp.status(),
    id: createBJson?.appointment?.id,
    appointmentStatus: createBJson?.appointment?.status,
    starts_at: createBJson?.appointment?.starts_at,
  });
  if (!createBResp.ok()) throw new Error(`B confirm failed: ${JSON.stringify(createBJson)}`);
  await pageB.waitForURL(/booking-done/, { timeout: 30000 });
  const bDoneH1 = (await pageB.locator("h1").first().innerText()).trim();
  log("B-done", { url: pageB.url(), h1: bDoneH1 });
  evidence.appointmentBId = createBJson?.appointment?.id;

  // --- Window A: confirm stolen slot ---
  const createAPromise = pageA.waitForResponse(
    (r) => r.url().includes("/api/appointments") && r.request().method() === "POST",
    { timeout: 45000 },
  );
  await confirmA.click();
  const createAResp = await createAPromise;
  const createAJson = await createAResp.json().catch(() => null);
  log("A-confirm-api", {
    status: createAResp.status(),
    code: createAJson?.error?.code,
    message: createAJson?.error?.message,
    body: createAJson,
  });

  await pageA.waitForTimeout(1500);
  const aUrl = pageA.url();
  const aMain = await pageA.locator("main").innerText();
  const slotTakenVisible =
    /Это время уже занято/i.test(aMain) ||
    (await pageA.locator("text=Это время уже занято").count()) > 0;
  const reserveExpiredWrong =
    /Резерв истек/i.test(aMain) && !slotTakenVisible;
  const onDone = /booking-done/.test(aUrl);
  const aSuccessAppt = createAResp.ok() && createAJson?.appointment?.id;

  log("A-after-confirm-ui", {
    url: aUrl,
    slotTakenVisible,
    reserveExpiredWrong,
    onDone,
    aSuccessAppt: Boolean(aSuccessAppt),
    mainSnippet: aMain.slice(0, 800).replace(/\n/g, " | "),
  });

  const pass =
    !onDone &&
    !aSuccessAppt &&
    slotTakenVisible &&
    !reserveExpiredWrong &&
    (createAResp.status() === 409 || slotTakenVisible);

  evidence.ok = pass;
  evidence.status = pass ? "pass" : "fail";
  evidence.expects = {
    aSeesSlotTaken: slotTakenVisible,
    aNoDone: !onDone,
    aNoAppointment: !aSuccessAppt,
    notWrongExpiredOnly: !reserveExpiredWrong,
    bGotDone: /booking-done/.test(pageB.url()),
  };
  log("RESULT", { status: evidence.status, expects: evidence.expects });

  // Cleanup: cancel B's appointment
  if (evidence.appointmentBId) {
    const cancel = await pageB.request.fetch(
      `${BASE}/api/appointments/${evidence.appointmentBId}/cancel`,
      { method: "POST", headers: { "Content-Type": "application/json" }, data: "{}" },
    );
    const cancelJson = await cancel.json().catch(() => null);
    log("cleanup-cancel-B", {
      status: cancel.status(),
      appointmentStatus: cancelJson?.appointment?.status,
    });
  }
} catch (err) {
  evidence.status = "fail";
  evidence.error = String(err.message || err);
  log("FATAL", { error: evidence.error });
} finally {
  evidence.finishedAt = new Date().toISOString();
  writeFileSync(
    new URL("./_s3-evidence.json", import.meta.url),
    JSON.stringify(evidence, null, 2),
    "utf8",
  );
  await browser.close();
}

process.exit(evidence.status === "pass" ? 0 : 1);
