import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { addMinutesIso, nowUtcIso } from "./time.js";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nogotochki-overlap-"));
process.env.DATABASE_PATH = path.join(tempDir, "test.sqlite");
process.env.NODE_ENV = "test";
process.env.DEV_ADMIN_PASSWORD = "DevAdmin123!";
process.env.DEV_MASTER_PASSWORD = "DevMaster123!";
process.env.DEV_CLIENT_PASSWORD = "DevClient123!";

const { applyMigrations } = await import("../db/migrate.js");
const { seedDev } = await import("../db/seed-dev.js");
const { closeDb, getDb } = await import("../db/connection.js");
const { isAppointmentOverlap } = await import("../http/errors.js");
const { insertAppointment, rescheduleAppointment } = await import("./appointments.js");

let db;
let clientId;
let occupying;

function insertTestAppointment(spec) {
  return insertAppointment(db, {
    clientId: spec.client_id,
    masterId: spec.master_id,
    startsAt: spec.starts_at,
    endsAt: spec.ends_at,
    status: spec.status,
    overlapOverride: spec.overlap_override ?? 0,
  });
}

function expectOverlap(fn) {
  assert.throws(fn, (error) => isAppointmentOverlap(error));
}

before(() => {
  applyMigrations();
  seedDev();
  db = getDb();
  clientId = db.prepare("SELECT id FROM clients WHERE email = 'client@nogotochki.test'").get().id;
  occupying = db
    .prepare(
      `
      SELECT * FROM appointments
      WHERE master_id = 1 AND status IN ('pending_prepayment', 'confirmed', 'rescheduled')
      ORDER BY starts_at
      LIMIT 1
      `,
    )
    .get();
  assert.ok(occupying);
});

after(() => {
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("INSERT overlap on the same master is aborted", () => {
  expectOverlap(() =>
    insertTestAppointment({
      client_id: clientId,
      master_id: occupying.master_id,
      starts_at: occupying.starts_at,
      ends_at: occupying.ends_at,
      status: "pending_prepayment",
    }),
  );
});

test("adjacent visits are not an overlap", () => {
  const id = insertTestAppointment({
    client_id: clientId,
    master_id: occupying.master_id,
    starts_at: occupying.ends_at,
    ends_at: addMinutesIso(occupying.ends_at, 90),
    status: "confirmed",
  });
  assert.ok(id > 0);
});

test("cancelled and expired visits do not block the slot", () => {
  const startsAt = addMinutesIso(occupying.ends_at, 180);
  const endsAt = addMinutesIso(startsAt, 90);

  insertTestAppointment({
    client_id: clientId,
    master_id: occupying.master_id,
    starts_at: startsAt,
    ends_at: endsAt,
    status: "cancelled",
  });
  insertTestAppointment({
    client_id: clientId,
    master_id: occupying.master_id,
    starts_at: startsAt,
    ends_at: endsAt,
    status: "expired",
  });
  const id = insertTestAppointment({
    client_id: clientId,
    master_id: occupying.master_id,
    starts_at: startsAt,
    ends_at: endsAt,
    status: "pending_prepayment",
  });
  assert.ok(id > 0);
});

test("UPDATE overlap including master change is aborted", () => {
  const freeStart = addMinutesIso(occupying.ends_at, 360);
  const freeEnd = addMinutesIso(freeStart, 60);
  const id = insertTestAppointment({
    client_id: clientId,
    master_id: 2,
    starts_at: freeStart,
    ends_at: freeEnd,
    status: "confirmed",
  });

  expectOverlap(() =>
    rescheduleAppointment(db, {
      id,
      masterId: occupying.master_id,
      startsAt: occupying.starts_at,
      endsAt: occupying.ends_at,
      overlapOverride: 0,
    }),
  );

  const row = db.prepare("SELECT master_id, starts_at FROM appointments WHERE id = ?").get(id);
  assert.equal(row.master_id, 2);
  assert.equal(row.starts_at, freeStart);
});

test("INSERT with overlap_override=1 is allowed and then occupies the slot", () => {
  const overlayId = insertTestAppointment({
    client_id: clientId,
    master_id: occupying.master_id,
    starts_at: occupying.starts_at,
    ends_at: occupying.ends_at,
    status: "pending_prepayment",
    overlap_override: 1,
  });
  assert.ok(overlayId > 0);

  expectOverlap(() =>
    insertTestAppointment({
      client_id: clientId,
      master_id: occupying.master_id,
      starts_at: occupying.starts_at,
      ends_at: occupying.ends_at,
      status: "confirmed",
      overlap_override: 0,
    }),
  );
});
