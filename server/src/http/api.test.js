import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { addDaysYmd, isoWeekday, ymdInTimeZone } from "../domain/time.js";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nogotochki-api-"));
process.env.DATABASE_PATH = path.join(tempDir, "test.sqlite");
process.env.NODE_ENV = "test";
process.env.PORT = "0";
process.env.DEV_ADMIN_PASSWORD = "DevAdmin123!";
process.env.DEV_MASTER_PASSWORD = "DevMaster123!";
process.env.DEV_CLIENT_PASSWORD = "DevClient123!";

const { applyMigrations } = await import("../db/migrate.js");
const { seedDev } = await import("../db/seed-dev.js");
const { closeDb, getDb } = await import("../db/connection.js");
const { createApp } = await import("./app.js");
const { hashToken } = await import("../domain/auth.js");
const { parseScryptHash } = await import("../domain/password.js");
const { errorHandler } = await import("./errors.js");
const { configureAuthRateLimit, resetAuthRateLimits } = await import("./middleware/rate-limit.js");

let server;
let base;
const TIMEZONE = "Europe/Moscow";

function jsonHeaders(token) {
  const headers = { "content-type": "application/json" };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

async function api(pathname, options = {}) {
  const response = await fetch(`${base}${pathname}`, {
    ...options,
    headers: { ...jsonHeaders(options.token), ...options.headers },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

function assertNoSecrets(value) {
  const dump = JSON.stringify(value);
  assert.ok(!/password_hash/i.test(dump));
  assert.ok(!/token_hash/i.test(dump));
  assert.ok(!/"password"/i.test(dump));
}

function nextDateWithWeekday(weekday) {
  let ymd = ymdInTimeZone(new Date(), TIMEZONE);
  for (let i = 0; i < 16; i += 1) {
    if (isoWeekday(ymd) === weekday) {
      return ymd;
    }
    ymd = addDaysYmd(ymd, 1);
  }
  throw new Error("no date");
}

async function firstOpenSlot(masterId, serviceIds) {
  let ymd = ymdInTimeZone(new Date(), TIMEZONE);
  for (let i = 0; i < 21; i += 1) {
    if (isoWeekday(ymd) !== 7) {
      const result = await api(
        `/api/masters/${masterId}/availability?date=${ymd}&service_ids=${serviceIds.join(",")}`,
      );
      assert.equal(result.status, 200);
      if (result.body.slots.length > 0) {
        return { date: ymd, slot: result.body.slots[0], duration: result.body.duration_minutes };
      }
    }
    ymd = addDaysYmd(ymd, 1);
  }
  throw new Error("no open slot");
}

before(async () => {
  configureAuthRateLimit({ loginMax: 100, registerMax: 100, ipMax: 200, windowMs: 15 * 60 * 1000 });
  resetAuthRateLimits();
  applyMigrations();
  seedDev();
  const app = createApp();
  server = await new Promise((resolve) => {
    const httpServer = app.listen(0, "127.0.0.1", () => resolve(httpServer));
  });
  const address = server.address();
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("health is up", async () => {
  const result = await api("/api/health");
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
});

test("register login me logout", async () => {
  const email = `user-${Date.now()}@example.com`;
  const registered = await api("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email,
      password: "Secret123",
      password_confirmation: "Secret123",
      display_name: "Тест",
    }),
  });
  assert.equal(registered.status, 201);
  assert.equal(registered.body.client.email, email);
  assert.equal(registered.body.client.is_admin, false);
  assert.deepEqual(registered.body.client.roles, ["client"]);
  assert.ok(registered.body.token);
  assertNoSecrets(registered.body);

  const me = await api("/api/auth/me", { token: registered.body.token });
  assert.equal(me.status, 200);
  assert.equal(me.body.client.email, email);
  assert.deepEqual(me.body.client.roles, ["client"]);

  const loggedOut = await api("/api/auth/logout", { token: registered.body.token, method: "POST" });
  assert.equal(loggedOut.status, 200);

  const meAfter = await api("/api/auth/me", { token: registered.body.token });
  assert.equal(meAfter.status, 401);

  const login = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: "Secret123" }),
  });
  assert.equal(login.status, 200);
  assert.ok(login.body.token);
});

test("duplicate email is 409 and bad login is 401", async () => {
  const taken = await api("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: "client@nogotochki.test",
      password: "Secret123",
      password_confirmation: "Secret123",
    }),
  });
  assert.equal(taken.status, 409);

  const bad = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "nobody@example.com", password: "Secret123" }),
  });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error.message.includes("email"), true);
});

test("catalog lists services and masters without secrets", async () => {
  const services = await api("/api/services");
  assert.equal(services.status, 200);
  assert.ok(services.body.services.length >= 5);
  assert.ok(services.body.services.every((row) => Number.isInteger(row.price_rub)));
  assertNoSecrets(services.body);

  const masters = await api("/api/masters?service_ids=1");
  assert.equal(masters.status, 200);
  assert.ok(masters.body.masters.some((row) => row.id === 1));
  assert.ok(masters.body.masters.every((row) => row.id !== 2));
});

test("availability is empty on Sunday and sliced on a workday", async () => {
  const sunday = nextDateWithWeekday(7);
  const empty = await api(`/api/masters/1/availability?date=${sunday}&service_ids=1`);
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.slots, []);

  const open = await firstOpenSlot(1, [1]);
  assert.equal(open.duration, 90);
  assert.match(open.slot.starts_at, /Z$/);
  assert.ok(open.slot.starts_local);
});

test("second hold on the same slot returns 409", async () => {
  const { slot } = await firstOpenSlot(1, [1]);
  const first = await api("/api/holds", {
    method: "POST",
    body: JSON.stringify({ master_id: 1, service_ids: [1], starts_at: slot.starts_at }),
  });
  assert.equal(first.status, 201);
  assert.ok(first.body.hold.hold_token);
  assert.equal(first.body.hold.duration_minutes, 90);

  const second = await api("/api/holds", {
    method: "POST",
    body: JSON.stringify({ master_id: 1, service_ids: [1], starts_at: slot.starts_at }),
  });
  assert.equal(second.status, 409);
  assert.equal(second.body.error.code, "SLOT_TAKEN");
  assert.equal(second.body.error.message, "Это время уже занято");
  assert.ok(Array.isArray(second.body.slots));
  assert.ok(second.body.slots.length >= 1);
  assert.match(second.body.slots[0].starts_at, /Z$/);
  assert.doesNotMatch(JSON.stringify(second.body), /APPOINTMENT_OVERLAP|SQLITE/i);

  const fetched = await api(`/api/holds/${first.body.hold.hold_token}`);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.hold.total_price_rub, 1800);
});

test("hold becomes an appointment after login", async () => {
  const email = `book-${Date.now()}@example.com`;
  const { slot } = await firstOpenSlot(1, [1]);
  const hold = await api("/api/holds", {
    method: "POST",
    body: JSON.stringify({ master_id: 1, service_ids: [1], starts_at: slot.starts_at }),
  });
  assert.equal(hold.status, 201);

  const registered = await api("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email,
      password: "Secret123",
      password_confirmation: "Secret123",
      hold_token: hold.body.hold.hold_token,
    }),
  });
  assert.equal(registered.status, 201);
  const token = registered.body.token;

  const created = await api("/api/appointments", {
    method: "POST",
    token,
    body: JSON.stringify({ hold_token: hold.body.hold.hold_token }),
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.appointment.status, "pending_prepayment");
  assert.equal(created.body.appointment.exact_address, null);
  assert.equal(created.body.appointment.total_price_rub, 1800);

  const again = await api("/api/appointments", {
    method: "POST",
    token,
    body: JSON.stringify({ hold_token: hold.body.hold.hold_token }),
  });
  assert.equal(again.status, 409);

  const mine = await api("/api/appointments?scope=active", { token });
  assert.equal(mine.status, 200);
  assert.equal(mine.body.appointments.length, 1);

  const other = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "client@nogotochki.test", password: "DevClient123!" }),
  });
  const forbidden = await api(`/api/appointments/${created.body.appointment.id}`, {
    token: other.body.token,
  });
  assert.equal(forbidden.status, 403);

  const cancelled = await api(`/api/appointments/${created.body.appointment.id}/cancel`, {
    method: "POST",
    token,
  });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.appointment.status, "cancelled");
});

test("reschedule moves the same row", async () => {
  const email = `move-${Date.now()}@example.com`;
  const registered = await api("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email,
      password: "Secret123",
      password_confirmation: "Secret123",
    }),
  });
  const token = registered.body.token;
  const first = await firstOpenSlot(1, [1]);
  const hold = await api("/api/holds", {
    method: "POST",
    token,
    body: JSON.stringify({
      master_id: 1,
      service_ids: [1],
      starts_at: first.slot.starts_at,
    }),
  });
  const created = await api("/api/appointments", {
    method: "POST",
    token,
    body: JSON.stringify({ hold_token: hold.body.hold.hold_token }),
  });
  assert.equal(created.status, 201);
  const appointmentId = created.body.appointment.id;

  const availability = await api(
    `/api/masters/1/availability?date=${first.date}&service_ids=1&exclude_appointment_id=${appointmentId}`,
  );
  const nextSlot = availability.body.slots.find(
    (item) => item.starts_at !== created.body.appointment.starts_at,
  );
  assert.ok(nextSlot);

  const moved = await api(`/api/appointments/${appointmentId}/reschedule`, {
    method: "POST",
    token,
    body: JSON.stringify({ starts_at: nextSlot.starts_at }),
  });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.appointment.status, "rescheduled");
  assert.equal(moved.body.appointment.id, appointmentId);
  assert.equal(moved.body.appointment.starts_at, nextSlot.starts_at);
});

test("admin endpoints reject a client and allow an administrator role", async () => {
  const client = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "client@nogotochki.test", password: "DevClient123!" }),
  });
  const denied = await api("/api/admin/appointments", { token: client.body.token });
  assert.equal(denied.status, 403);

  const admin = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "admin@nogotochki.test", password: "DevAdmin123!" }),
  });
  const all = await api("/api/admin/appointments", { token: admin.body.token });
  assert.equal(all.status, 200);
  assert.ok(all.body.appointments.length >= 1);
  assert.ok(all.body.appointments[0].client.email);
  assertNoSecrets(all.body);

  const pending = all.body.appointments.find((row) => row.status === "pending_prepayment");
  assert.ok(pending);
  const confirmed = await api(`/api/admin/appointments/${pending.id}`, {
    method: "PATCH",
    token: admin.body.token,
    body: JSON.stringify({ status: "confirmed" }),
  });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.appointment.status, "confirmed");

  const createdService = await api("/api/admin/services", {
    method: "POST",
    token: admin.body.token,
    body: JSON.stringify({
      slug: "test_oil",
      name: "Тестовая услуга",
      price_rub: 500,
      duration_min_minutes: 30,
      duration_max_minutes: 30,
      is_addon: 0,
      is_bookable: 1,
    }),
  });
  assert.equal(createdService.status, 201);
  assert.equal(createdService.body.service.price_rub, 500);

  const patched = await api(`/api/admin/services/${createdService.body.service.id}`, {
    method: "PATCH",
    token: admin.body.token,
    body: JSON.stringify({ price_rub: 700 }),
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.service.price_rub, 700);

  const createdMaster = await api("/api/admin/masters", {
    method: "POST",
    token: admin.body.token,
    body: JSON.stringify({
      specialization_label: "Тест",
      service_ids: [createdService.body.service.id],
      schedule: [{ weekday: 1, start_time: "10:00", end_time: "14:00" }],
    }),
  });
  assert.equal(createdMaster.status, 201);
  assert.deepEqual(createdMaster.body.master.service_ids, [createdService.body.service.id]);

  const deletedService = await api(`/api/admin/services/${createdService.body.service.id}`, {
    method: "DELETE",
    token: admin.body.token,
  });
  assert.equal(deletedService.status, 200);

  const blocked = await api("/api/admin/services/1", {
    method: "DELETE",
    token: admin.body.token,
  });
  assert.equal(blocked.status, 409);
});

test("client overlap_override is ignored and does not stack on a busy slot", async () => {
  const client = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "client@nogotochki.test", password: "DevClient123!" }),
  });
  const mine = await api("/api/appointments?scope=active", { token: client.body.token });
  const busy = mine.body.appointments[0];
  assert.ok(busy);

  const hold = await api("/api/holds", {
    method: "POST",
    token: client.body.token,
    body: JSON.stringify({
      master_id: busy.master.id,
      service_ids: [busy.services[0].id],
      starts_at: busy.starts_at,
      overlap_override: true,
    }),
  });
  assert.equal(hold.status, 409);
  assert.equal(hold.body.error.code, "SLOT_TAKEN");
});

test("admin overlap_override can sit on a busy slot; later clients still see it occupied", async () => {
  const client = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "client@nogotochki.test", password: "DevClient123!" }),
  });
  const mine = await api("/api/appointments?scope=active", { token: client.body.token });
  const busy = mine.body.appointments[0];
  const admin = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "admin@nogotochki.test", password: "DevAdmin123!" }),
  });

  const hold = await api("/api/holds", {
    method: "POST",
    token: admin.body.token,
    body: JSON.stringify({
      master_id: busy.master.id,
      service_ids: [busy.services[0].id],
      starts_at: busy.starts_at,
      overlap_override: true,
    }),
  });
  assert.equal(hold.status, 201);

  const created = await api("/api/appointments", {
    method: "POST",
    token: admin.body.token,
    body: JSON.stringify({
      hold_token: hold.body.hold.hold_token,
      overlap_override: true,
    }),
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.appointment.overlap_override, true);

  const blocked = await api("/api/holds", {
    method: "POST",
    token: client.body.token,
    body: JSON.stringify({
      master_id: busy.master.id,
      service_ids: [busy.services[0].id],
      starts_at: busy.starts_at,
      overlap_override: true,
    }),
  });
  assert.equal(blocked.status, 409);
});

test("passwords are unique salted scrypt and sessions store only the hash", async () => {
  const db = getDb();
  const seeded = db
    .prepare(
      `
      SELECT email, password_hash FROM clients
      WHERE email IN ('admin@nogotochki.test', 'master@nogotochki.test', 'client@nogotochki.test')
      ORDER BY email
      `,
    )
    .all();
  assert.equal(seeded.length, 3);
  const salts = new Set();
  for (const row of seeded) {
    assert.equal(row.password_hash.startsWith("$2"), false);
    assert.match(row.password_hash, /^\$scrypt\$N=\d+\$r=\d+\$p=\d+\$/);
    const parsed = parseScryptHash(row.password_hash);
    assert.ok(parsed);
    salts.add(parsed.salt.toString("base64url"));
  }
  assert.equal(salts.size, 3);

  const first = await api("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: `scrypt-a-${Date.now()}@example.com`,
      password: "Secret123",
      password_confirmation: "Secret123",
      role: "administrator",
      roles: ["administrator"],
      is_admin: true,
      client_id: 1,
      password_hash: "ignore-me",
      status: "confirmed",
    }),
  });
  const second = await api("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: `scrypt-b-${Date.now()}@example.com`,
      password: "Secret123",
      password_confirmation: "Secret123",
    }),
  });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.deepEqual(first.body.client.roles, ["client"]);
  assert.equal(first.body.client.is_admin, false);

  const hashes = db
    .prepare("SELECT email, password_hash FROM clients WHERE id IN (?, ?)")
    .all(first.body.client.id, second.body.client.id);
  const parsedA = parseScryptHash(hashes[0].password_hash);
  const parsedB = parseScryptHash(hashes[1].password_hash);
  assert.ok(parsedA && parsedB);
  assert.notEqual(parsedA.salt.toString("base64url"), parsedB.salt.toString("base64url"));

  const token = first.body.token;
  const session = db.prepare("SELECT token_hash, expires_at FROM sessions WHERE client_id = ?").get(first.body.client.id);
  assert.ok(session);
  assert.notEqual(session.token_hash, token);
  assert.equal(session.token_hash, hashToken(token));
  assert.ok(session.expires_at > new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));
});

test("appointment visibility follows the role list", async () => {
  const client = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "client@nogotochki.test", password: "DevClient123!" }),
  });
  const master = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "master@nogotochki.test", password: "DevMaster123!" }),
  });
  const admin = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "admin@nogotochki.test", password: "DevAdmin123!" }),
  });
  assert.deepEqual(master.body.client.roles, ["master"]);
  assert.equal(master.body.client.is_admin, false);
  assert.deepEqual(admin.body.client.roles, ["administrator"]);
  assert.equal(admin.body.client.is_admin, true);

  const deniedAdmin = await api("/api/admin/appointments", { token: client.body.token });
  assert.equal(deniedAdmin.status, 403);

  const masterAdmin = await api("/api/admin/appointments", { token: master.body.token });
  assert.equal(masterAdmin.status, 403);

  const adminList = await api("/api/admin/appointments", { token: admin.body.token });
  assert.equal(adminList.status, 200);
  const allIds = new Set(adminList.body.appointments.map((row) => row.id));
  assert.ok(allIds.size >= 3);

  const unifiedAdmin = await api("/api/appointments", { token: admin.body.token });
  assert.equal(unifiedAdmin.status, 200);
  assert.ok(unifiedAdmin.body.appointments.length >= adminList.body.appointments.length);

  const masterList = await api("/api/appointments", { token: master.body.token });
  assert.equal(masterList.status, 200);
  assert.ok(masterList.body.appointments.length >= 1);
  assert.ok(masterList.body.appointments.every((row) => row.master.id === 1));

  const otherMasterAppointment = adminList.body.appointments.find((row) => row.master.id === 2);
  assert.ok(otherMasterAppointment);
  const masterForbidden = await api(`/api/appointments/${otherMasterAppointment.id}`, {
    token: master.body.token,
  });
  assert.equal(masterForbidden.status, 403);

  const ownSchedule = masterList.body.appointments[0];
  const masterCanSee = await api(`/api/appointments/${ownSchedule.id}`, { token: master.body.token });
  assert.equal(masterCanSee.status, 200);
  assert.equal(masterCanSee.body.appointment.id, ownSchedule.id);

  const masterCannotCancel = await api(`/api/appointments/${ownSchedule.id}/cancel`, {
    method: "POST",
    token: master.body.token,
  });
  assert.equal(masterCannotCancel.status, 403);

  const otherClientAppointment = adminList.body.appointments.find(
    (row) => row.client?.email === "client@nogotochki.test",
  );
  const outsider = await api("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: `other-${Date.now()}@example.com`,
      password: "Secret123",
      password_confirmation: "Secret123",
    }),
  });
  const strangerGet = await api(`/api/appointments/${otherClientAppointment.id}`, {
    token: outsider.body.token,
  });
  assert.equal(strangerGet.status, 403);
  const strangerCancel = await api(`/api/appointments/${otherClientAppointment.id}/cancel`, {
    method: "POST",
    token: outsider.body.token,
  });
  assert.equal(strangerCancel.status, 403);
});

test("extra body fields and invalid dates are rejected or ignored", async () => {
  const badDate = await api("/api/holds", {
    method: "POST",
    body: JSON.stringify({
      master_id: 1,
      service_ids: [1],
      starts_at: "2026-02-31T07:00:00Z",
    }),
  });
  assert.equal(badDate.status, 400);

  const tooLong = await api("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: `long-${Date.now()}@example.com`,
      password: "a".repeat(201),
      password_confirmation: "a".repeat(201),
    }),
  });
  assert.equal(tooLong.status, 400);

  const client = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "client@nogotochki.test", password: "DevClient123!" }),
  });
  const mine = await api("/api/appointments?scope=active", { token: client.body.token });
  const appointment = mine.body.appointments[0];
  const rescheduleIgnored = await api(`/api/appointments/${appointment.id}/reschedule`, {
    method: "POST",
    token: client.body.token,
    body: JSON.stringify({
      starts_at: appointment.starts_at,
      status: "confirmed",
      overlap_override: true,
      client_id: 999,
    }),
  });
  assert.notEqual(rescheduleIgnored.status, 500);
  if (rescheduleIgnored.status === 200) {
    assert.notEqual(rescheduleIgnored.body.appointment.status, "confirmed");
    assert.equal(rescheduleIgnored.body.appointment.overlap_override, false);
  }
});

test("login and register bursts return 429", async () => {
  configureAuthRateLimit({ loginMax: 4, registerMax: 4, ipMax: 100, windowMs: 60_000 });
  resetAuthRateLimits();
  try {
    let lastLogin;
    for (let i = 0; i < 6; i += 1) {
      lastLogin = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "brute@example.com", password: "WrongPass1" }),
      });
    }
    assert.equal(lastLogin.status, 429);
    assert.equal(lastLogin.body.error.code, "RATE_LIMITED");
    assert.equal(lastLogin.body.error.message, "Слишком много попыток, попробуйте позже");
    assert.doesNotMatch(JSON.stringify(lastLogin.body), /sqlite|bucket|stack|limiter/i);

    resetAuthRateLimits();
    let lastRegister;
    for (let i = 0; i < 6; i += 1) {
      lastRegister = await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email: `burst-${Date.now()}-${i}@example.com`,
          password: "Secret123",
          password_confirmation: "Secret123",
        }),
      });
    }
    assert.equal(lastRegister.status, 429);
    assert.equal(lastRegister.body.error.code, "RATE_LIMITED");
  } finally {
    configureAuthRateLimit({ loginMax: 100, registerMax: 100, ipMax: 200, windowMs: 15 * 60 * 1000 });
    resetAuthRateLimits();
  }
});

test("spoofed X-Forwarded-For does not reset login rate limit", async () => {
  configureAuthRateLimit({ loginMax: 4, registerMax: 4, ipMax: 100, windowMs: 60_000 });
  resetAuthRateLimits();
  try {
    let lastLogin;
    for (let i = 0; i < 6; i += 1) {
      lastLogin = await api("/api/auth/login", {
        method: "POST",
        headers: { "x-forwarded-for": `203.0.113.${i + 1}` },
        body: JSON.stringify({ email: "xff-brute@example.com", password: "WrongPass1" }),
      });
    }
    assert.equal(lastLogin.status, 429);
    assert.equal(lastLogin.body.error.code, "RATE_LIMITED");
  } finally {
    configureAuthRateLimit({ loginMax: 100, registerMax: 100, ipMax: 200, windowMs: 15 * 60 * 1000 });
    resetAuthRateLimits();
  }
});

test("error handler does not echo sqlite or file paths", async () => {
  const captured = [];
  const res = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      captured.push(body);
      return this;
    },
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    errorHandler(
      new Error("UNIQUE constraint failed: clients.email at C:\\Users\\nikus\\data\\nogotochki.sqlite"),
      {},
      res,
      () => {},
    );
    assert.equal(res.statusCode, 500);
    assert.equal(captured[0].error.code, "SERVER_ERROR");
    assert.equal(captured[0].error.message, "Внутренняя ошибка сервера");
    assert.doesNotMatch(JSON.stringify(captured[0]), /UNIQUE constraint|nogotochki\.sqlite|Users\\nikus/i);

    captured.length = 0;
    errorHandler(
      Object.assign(new Error("SQLITE_ERROR: no such table secrets"), { code: "SQLITE_ERROR" }),
      {},
      res,
      () => {},
    );
    assert.equal(captured[0].error.message, "Внутренняя ошибка сервера");
    assert.doesNotMatch(JSON.stringify(captured[0]), /SQLITE_ERROR|no such table/i);
  } finally {
    console.error = originalError;
  }
});

