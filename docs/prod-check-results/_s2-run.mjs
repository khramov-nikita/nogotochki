import { chromium } from "playwright";
import { writeFileSync } from "fs";

const BASE = process.env.S2_BASE || "https://nogotochki-test.ru";
const outPath = new URL("./_s2-evidence.json", import.meta.url);

const evidence = {
  base: BASE,
  startedAt: new Date().toISOString(),
  steps: [],
  ok: false,
  holdTokenA: null,
  cleanup: null,
};

function log(msg, data) {
  const row = { msg, at: new Date().toISOString(), ...(data || {}) };
  evidence.steps.push(row);
  console.log(JSON.stringify(row));
}

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, ok: res.ok, json };
}

async function goToStep3(page, label) {
  await page.evaluate(() => {
    sessionStorage.clear();
    localStorage.clear();
  }).catch(() => {});

  await page.goto(`${BASE}/booking.html`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector("#services-main input[type=checkbox]", { timeout: 30000 });
  await page.locator("#services-main input[type=checkbox]").first().check();
  await page.waitForTimeout(400);
  await page.locator("#next-btn").click();
  await page.waitForURL(/booking-master/, { timeout: 30000 });

  await page.waitForTimeout(800);
  const radios = page.locator('input[name="master_id"]:not([disabled])');
  if ((await radios.count()) === 0) throw new Error(`${label}: no masters`);
  await radios.first().check({ force: true });
  await page.waitForTimeout(300);
  await page.locator("#next-btn").click();
  await page.waitForURL(/booking-datetime/, { timeout: 30000 });
  await page.waitForSelector("#calendar-grid button, .calendar-grid button", { timeout: 30000 });
  log(`${label}-step3`, { url: page.url() });
}

async function openDayWithSlot(page, label, preferredHour) {
  await page.waitForTimeout(800);
  const dayButtons = page.locator("#calendar-grid button:not([disabled])");
  const dayCount = await dayButtons.count();
  for (let i = 0; i < Math.min(dayCount, 28); i++) {
    await dayButtons.nth(i).click();
    await page.waitForTimeout(1100);
    const slots = page.locator(".time-slot:not([disabled])");
    const sc = await slots.count();
    if (sc === 0) continue;
    let idx = 0;
    if (preferredHour) {
      for (let j = 0; j < sc; j++) {
        const t = (await slots.nth(j).innerText()).trim();
        if (t.includes(preferredHour)) {
          idx = j;
          break;
        }
      }
    }
    const slotText = (await slots.nth(idx).innerText()).trim();
    const dayText = (await dayButtons.nth(i).innerText()).trim();
    log(`${label}-day`, { i, dayText, slotCount: sc, slotText });
    return { dayIndex: i, slotIndex: idx, slotText, dayText };
  }
  throw new Error(`${label}: no free slots`);
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
  const services = await api("/api/services");
  const masters = await api("/api/masters");
  const serviceId =
    services.json?.services?.find((s) => !s.is_addon)?.id ||
    services.json?.[0]?.id ||
    1;
  const masterId = masters.json?.masters?.[0]?.id || masters.json?.[0]?.id || 1;
  log("catalog", {
    serviceStatus: services.status,
    masterStatus: masters.status,
    serviceId,
    masterId,
  });

  let freeSlot = null;
  const today = new Date();
  for (let d = 1; d <= 14; d++) {
    const day = new Date(today);
    day.setDate(today.getDate() + d);
    const yyyy = day.getFullYear();
    const mm = String(day.getMonth() + 1).padStart(2, "0");
    const dd = String(day.getDate()).padStart(2, "0");
    const date = `${yyyy}-${mm}-${dd}`;
    const avail = await api(
      `/api/masters/${masterId}/availability?date=${date}&service_ids=${serviceId}`,
    );
    const slots = avail.json?.slots || avail.json?.starts || [];
    if (Array.isArray(slots) && slots.length) {
      const startsAt = typeof slots[0] === "string" ? slots[0] : slots[0].starts_at;
      freeSlot = { date, startsAt, availStatus: avail.status, slotCount: slots.length };
      break;
    }
  }
  log("api-free-slot", freeSlot);
  if (!freeSlot) throw new Error("No API free slot");

  const preferredHour = new Date(freeSlot.startsAt).toLocaleString("en-GB", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  await Promise.all([goToStep3(pageA, "A"), goToStep3(pageB, "B")]);

  // A discovers a free slot day first, then B opens same day/time from stale list
  const pickA = await openDayWithSlot(pageA, "A", preferredHour);

  // B: open same calendar day index and keep list without refreshing after A holds
  {
    const dayButtons = pageB.locator("#calendar-grid button:not([disabled])");
    await dayButtons.nth(pickA.dayIndex).click();
    await pageB.waitForTimeout(1100);
  }

  // A creates hold
  const holdPromiseA = pageA.waitForResponse(
    (r) => r.url().includes("/api/holds") && r.request().method() === "POST",
    { timeout: 25000 },
  );
  await pageA.locator(".time-slot:not([disabled])").nth(pickA.slotIndex).click();
  const holdRespA = await holdPromiseA;
  const holdBodyA = await holdRespA.json().catch(() => null);
  evidence.holdTokenA = holdBodyA?.hold?.hold_token || holdBodyA?.hold_token || null;
  const timerA = await pageA.locator("#hold-timer").isVisible().catch(() => false);
  const timerTextA = timerA ? (await pageA.locator("#hold-timer").innerText()).trim() : null;
  log("A-hold", {
    status: holdRespA.status(),
    ok: holdRespA.ok(),
    starts_at: holdBodyA?.hold?.starts_at,
    expires_at: holdBodyA?.hold?.expires_at,
    hold_token: evidence.holdTokenA?.slice(0, 12),
    timerVisible: timerA,
    timerText: timerTextA,
  });
  if (!holdRespA.ok()) throw new Error("A hold failed: " + JSON.stringify(holdBodyA));

  // B clicks same time text on already-open list
  const holdPromiseB = pageB.waitForResponse(
    (r) => r.url().includes("/api/holds") && r.request().method() === "POST",
    { timeout: 25000 },
  );
  const slotB = pageB.locator(`.time-slot:has-text("${pickA.slotText}")`).first();
  if ((await slotB.count()) === 0) {
    await pageB.locator(".time-slot").first().click();
  } else {
    await slotB.click();
  }
  const holdRespB = await holdPromiseB;
  const holdBodyB = await holdRespB.json().catch(() => null);
  await pageB.waitForTimeout(900);

  const slotErrorEl = pageB.locator("#slot-error");
  const slotErrorVisible = await slotErrorEl.isVisible().catch(() => false);
  const slotError = slotErrorVisible
    ? (await slotErrorEl.innerText()).trim()
    : (
        await pageB
          .locator(".empty-state, .banner, [role='alert'], .error")
          .first()
          .innerText()
          .catch(() => "")
      ).trim();
  const timerB = await pageB.locator("#hold-timer").isVisible().catch(() => false);
  const doneB = /booking-done/.test(pageB.url());
  const mainB = (await pageB.locator("main").innerText().catch(() => "")).slice(0, 400);

  log("B-hold-ui", {
    status: holdRespB.status(),
    ok: holdRespB.ok(),
    errorCode: holdBodyB?.error?.code,
    errorMessage: holdBodyB?.error?.message,
    slotError,
    slotErrorVisible,
    timerVisible: timerB,
    donePage: doneB,
    url: pageB.url(),
    mainSnippet: mainB.replace(/\n/g, " | "),
  });

  // Direct API second hold without A's token
  const startsAt = holdBodyA?.hold?.starts_at || freeSlot.startsAt;
  const apiHoldB = await api("/api/holds", {
    method: "POST",
    body: JSON.stringify({
      master_id: masterId,
      service_ids: [serviceId],
      starts_at: startsAt,
    }),
  });
  log("B-hold-api", {
    status: apiHoldB.status,
    errorCode: apiHoldB.json?.error?.code,
    errorMessage: apiHoldB.json?.error?.message,
    slotsHint: Array.isArray(apiHoldB.json?.slots) ? apiHoldB.json.slots.length : null,
  });

  const occupiedMsg =
    /уже занято/i.test(slotError) ||
    /уже занято/i.test(holdBodyB?.error?.message || "") ||
    /уже занято/i.test(apiHoldB.json?.error?.message || "") ||
    /уже занято/i.test(mainB);

  const bRejected =
    holdRespB.status() === 409 ||
    holdBodyB?.error?.code === "SLOT_TAKEN" ||
    apiHoldB.status === 409;

  evidence.ok =
    holdRespA.ok() &&
    Boolean(evidence.holdTokenA) &&
    timerA &&
    bRejected &&
    occupiedMsg &&
    !doneB &&
    !timerB;

  log("verdict", {
    ok: evidence.ok,
    aHoldOk: holdRespA.ok(),
    timerA,
    bUiStatus: holdRespB.status(),
    bApiStatus: apiHoldB.status,
    occupiedMsg,
    doneB,
    timerB,
  });
} catch (err) {
  log("error", { message: String(err), stack: err?.stack });
  evidence.ok = false;
} finally {
  if (evidence.holdTokenA) {
    const del = await api(`/api/holds/${evidence.holdTokenA}`, { method: "DELETE" });
    evidence.cleanup = { status: del.status, ok: del.ok };
    log("cleanup-delete-A", evidence.cleanup);
  }
  evidence.finishedAt = new Date().toISOString();
  writeFileSync(outPath, JSON.stringify(evidence, null, 2), "utf8");
  await browser.close();
  console.log("EVIDENCE_WRITTEN", outPath.pathname);
  process.exit(evidence.ok ? 0 : 1);
}
