import { isMainModule } from "./cli.js";
import { DATABASE_PATH, closeDb, getDb, runInTransaction } from "./connection.js";
import { insertAppointment } from "../domain/appointments.js";
import { hashPasswordSync } from "../domain/password.js";
import { ROLE_ADMINISTRATOR, ROLE_CLIENT, ROLE_MASTER, replaceClientRoles } from "../domain/roles.js";

const TIMEZONE = "Europe/Moscow";
const COUNT_TABLES = [
  "clients",
  "services",
  "masters",
  "master_schedule",
  "appointments",
  "appointment_services",
  "roles",
  "client_roles",
];

function requireDevPassword(envKey) {
  const value = process.env[envKey];
  if (typeof value !== "string" || value.length < 8) {
    throw new Error(`${envKey} must be set (see .env.example)`);
  }
  return value;
}

function testUsers() {
  return [
    {
      key: "admin",
      email: "admin@nogotochki.test",
      password: requireDevPassword("DEV_ADMIN_PASSWORD"),
      display_name: "Администратор",
      roles: [ROLE_ADMINISTRATOR],
    },
    {
      key: "master",
      email: "master@nogotochki.test",
      password: requireDevPassword("DEV_MASTER_PASSWORD"),
      display_name: "Мастер",
      roles: [ROLE_MASTER],
    },
    {
      key: "client",
      email: "client@nogotochki.test",
      password: requireDevPassword("DEV_CLIENT_PASSWORD"),
      display_name: "Клиент",
      roles: [ROLE_CLIENT],
    },
  ];
}

function nowUtc() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function todayMoscowYmd() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDaysYmd(ymd, days) {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function isoWeekday(ymd) {
  const [year, month, day] = ymd.split("-").map(Number);
  const utcDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return utcDay === 0 ? 7 : utcDay;
}

function nextWorkdays(count) {
  const days = [];
  let ymd = addDaysYmd(todayMoscowYmd(), 1);
  while (days.length < count) {
    if (isoWeekday(ymd) !== 7) {
      days.push(ymd);
    }
    ymd = addDaysYmd(ymd, 1);
  }
  return days;
}

function moscowToUtc(ymd, timeHm) {
  return new Date(`${ymd}T${timeHm}:00+03:00`).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function addMinutesIso(iso, minutes) {
  return new Date(Date.parse(iso) + minutes * 60 * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
}

function assertDevEnvironment() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("seed:dev нельзя запускать при NODE_ENV=production");
  }
}

function seedStudioSettings(db, now) {
  db.prepare(
    `
    INSERT OR IGNORE INTO studio_settings (
      id, display_name, kicker, hero_image_path, public_location, exact_address,
      timezone, calendar_horizon_days, slot_step_minutes, min_lead_minutes,
      reserve_minutes, established_year, regular_clients_count,
      cancel_min_hours_before, reschedule_min_hours_before, reminder_hours_before,
      created_at, updated_at
    ) VALUES (
      1, 'Ноготочки', 'Студия маникюра и бровей', NULL, 'центр города', NULL,
      'Europe/Moscow', 56, 30, 0, 15, 2019, 400, NULL, NULL, NULL, ?, ?
    )
    `,
  ).run(now, now);
}

function seedServices(db, now) {
  const insertById = db.prepare(
    `
    INSERT OR IGNORE INTO services (
      id, slug, name, description, price_rub, price_rub_alt,
      duration_min_minutes, duration_max_minutes, is_addon, is_bookable,
      validity_months, image_path, sort_order, created_at, updated_at
    ) VALUES (
      @id, @slug, @name, NULL, @price_rub, NULL,
      @duration_min_minutes, @duration_max_minutes, @is_addon, @is_bookable,
      NULL, NULL, @sort_order, @created_at, @updated_at
    )
    `,
  );

  const insertBySlug = db.prepare(
    `
    INSERT OR IGNORE INTO services (
      slug, name, description, price_rub, price_rub_alt,
      duration_min_minutes, duration_max_minutes, is_addon, is_bookable,
      validity_months, image_path, sort_order, created_at, updated_at
    ) VALUES (
      @slug, @name, NULL, @price_rub, NULL,
      @duration_min_minutes, @duration_max_minutes, @is_addon, @is_bookable,
      NULL, NULL, @sort_order, @created_at, @updated_at
    )
    `,
  );

  const rows = [
    {
      id: 1,
      slug: "manicure_gel",
      name: "Маникюр с покрытием гель-лаком",
      price_rub: 1800,
      duration_min_minutes: 90,
      duration_max_minutes: 90,
      is_addon: 0,
      is_bookable: 1,
      sort_order: 1,
    },
    {
      id: 2,
      slug: "manicure_pedicure",
      name: "Маникюр и педикюр",
      price_rub: 3200,
      duration_min_minutes: 150,
      duration_max_minutes: 150,
      is_addon: 0,
      is_bookable: 1,
      sort_order: 2,
    },
    {
      id: 3,
      slug: "extension",
      name: "Наращивание ногтей",
      price_rub: 2800,
      duration_min_minutes: 150,
      duration_max_minutes: 150,
      is_addon: 0,
      is_bookable: 1,
      sort_order: 3,
    },
    {
      id: 4,
      slug: "brow_correction",
      name: "Коррекция и окрашивание бровей",
      price_rub: 1200,
      duration_min_minutes: 40,
      duration_max_minutes: 40,
      is_addon: 0,
      is_bookable: 1,
      sort_order: 5,
    },
    {
      id: 5,
      slug: "brow_lamination",
      name: "Ламинирование бровей",
      price_rub: 1800,
      duration_min_minutes: 60,
      duration_max_minutes: 60,
      is_addon: 0,
      is_bookable: 1,
      sort_order: 6,
    },
  ];

  for (const row of rows) {
    insertById.run({ ...row, created_at: now, updated_at: now });
  }

  // Без фиксированного id: в dev-БД id 4 уже может быть у бровей.
  insertBySlug.run({
    slug: "nail_design",
    name: "Дизайн ногтей",
    price_rub: 300,
    duration_min_minutes: 15,
    duration_max_minutes: 30,
    is_addon: 1,
    is_bookable: 1,
    sort_order: 4,
    created_at: now,
    updated_at: now,
  });
}

function seedMasters(db, now) {
  const insert = db.prepare(
    `
    INSERT INTO masters (
      id, display_name, specialization_label, portrait_path, cover_path,
      is_active, sort_order, created_at, updated_at
    ) VALUES (
      @id, NULL, @specialization_label, NULL, NULL, 1, @sort_order, @created_at, @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      specialization_label = excluded.specialization_label,
      is_active = 1,
      sort_order = excluded.sort_order,
      updated_at = excluded.updated_at
    `,
  );

  insert.run({
    id: 1,
    specialization_label: "Маникюр и покрытие",
    sort_order: 1,
    created_at: now,
    updated_at: now,
  });
  insert.run({
    id: 2,
    specialization_label: "Брови",
    sort_order: 2,
    created_at: now,
    updated_at: now,
  });
}

function seedMasterServices(db) {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO master_services (master_id, service_id) VALUES (?, ?)",
  );
  const pairs = [
    [1, 1],
    [1, 2],
    [1, 3],
    [2, 4],
    [2, 5],
  ];
  for (const [masterId, serviceId] of pairs) {
    insert.run(masterId, serviceId);
  }

  const nailDesign = db.prepare("SELECT id FROM services WHERE slug = 'nail_design'").get();
  if (nailDesign) {
    insert.run(1, nailDesign.id);
  }
}

function seedMasterSchedule(db, now) {
  const insert = db.prepare(
    `
    INSERT OR IGNORE INTO master_schedule (
      master_id, weekday, start_time, end_time, created_at
    ) VALUES (?, ?, '10:00', '18:00', ?)
    `,
  );

  for (const masterId of [1, 2]) {
    for (let weekday = 1; weekday <= 6; weekday += 1) {
      insert.run(masterId, weekday, now);
    }
  }
}

function upsertUsers(db, now) {
  const upsert = db.prepare(
    `
    INSERT INTO clients (email, password_hash, display_name, created_at, updated_at)
    VALUES (@email, @password_hash, @display_name, @created_at, @updated_at)
    ON CONFLICT(email) DO UPDATE SET
      password_hash = excluded.password_hash,
      display_name = excluded.display_name,
      updated_at = excluded.updated_at
    `,
  );

  const ids = {};
  for (const user of testUsers()) {
    const password_hash = hashPasswordSync(user.password);
    upsert.run({
      email: user.email,
      password_hash,
      display_name: user.display_name,
      created_at: now,
      updated_at: now,
    });
    ids[user.key] = db.prepare("SELECT id FROM clients WHERE email = ?").get(user.email).id;
    replaceClientRoles(db, ids[user.key], user.roles, now);
  }

  db.prepare("UPDATE masters SET client_id = NULL WHERE client_id = ?").run(ids.master);
  db.prepare("UPDATE masters SET client_id = ? WHERE id = 1").run(ids.master);
  return ids;
}

function upsertAppointment(db, now, spec) {
  const existing = db
    .prepare(
      `
      SELECT id FROM appointments
      WHERE client_id = ? AND master_id = ? AND starts_at = ?
      `,
    )
    .get(spec.client_id, spec.master_id, spec.starts_at);

  if (existing) {
    return existing.id;
  }

  return insertAppointment(db, {
    clientId: spec.client_id,
    masterId: spec.master_id,
    startsAt: spec.starts_at,
    endsAt: spec.ends_at,
    status: spec.status,
    now,
    serviceId: spec.service_id,
  });
}

function seedAppointments(db, now, clientId) {
  const days = nextWorkdays(3);
  const gel = db.prepare("SELECT id, duration_max_minutes FROM services WHERE slug = 'manicure_gel'").get();
  const extension = db.prepare("SELECT id, duration_max_minutes FROM services WHERE slug = 'extension'").get();
  const lamination = db
    .prepare("SELECT id, duration_max_minutes FROM services WHERE slug = 'brow_lamination'")
    .get();

  const fixtures = [
    {
      day: days[0],
      time: "10:00",
      master_id: 1,
      service: gel,
      status: "pending_prepayment",
    },
    {
      day: days[1],
      time: "13:00",
      master_id: 1,
      service: extension,
      status: "confirmed",
    },
    {
      day: days[2],
      time: "11:00",
      master_id: 2,
      service: lamination,
      status: "confirmed",
    },
  ];

  for (const fixture of fixtures) {
    const starts_at = moscowToUtc(fixture.day, fixture.time);
    const ends_at = addMinutesIso(starts_at, fixture.service.duration_max_minutes);
    upsertAppointment(db, now, {
      client_id: clientId,
      master_id: fixture.master_id,
      starts_at,
      ends_at,
      status: fixture.status,
      service_id: fixture.service.id,
    });
  }
}

function printSummary(db) {
  const users = db
    .prepare(
      `
      SELECT c.id, c.email, c.display_name,
             CASE
               WHEN c.password_hash LIKE '$scrypt$%' THEN 'scrypt'
               WHEN c.password_hash LIKE '$2%' THEN 'bcrypt'
               ELSE 'other'
             END AS hash_kind,
             length(c.password_hash) AS hash_length,
             (
               SELECT GROUP_CONCAT(r.slug, ',')
               FROM client_roles cr
               JOIN roles r ON r.id = cr.role_id
               WHERE cr.client_id = c.id
             ) AS roles
      FROM clients c
      WHERE c.email LIKE '%@nogotochki.test'
      ORDER BY c.id
      `,
    )
    .all();
  const services = db
    .prepare(
      `
      SELECT slug, name, price_rub, duration_min_minutes, duration_max_minutes
      FROM services
      WHERE slug IN (
        'manicure_gel', 'manicure_pedicure', 'extension',
        'brow_correction', 'brow_lamination'
      )
      ORDER BY sort_order
      `,
    )
    .all();
  const masters = db
    .prepare(
      `
      SELECT id, display_name, specialization_label, is_active, client_id
      FROM masters
      WHERE id IN (1, 2)
      ORDER BY id
      `,
    )
    .all();
  const schedule = db
    .prepare(
      `
      SELECT master_id, weekday, start_time, end_time
      FROM master_schedule
      WHERE master_id IN (1, 2)
      ORDER BY master_id, weekday
      `,
    )
    .all();
  const appointments = db
    .prepare(
      `
      SELECT a.id, a.status, a.starts_at, a.ends_at, a.master_id, s.name AS service_name
      FROM appointments a
      JOIN appointment_services aps ON aps.appointment_id = a.id
      JOIN services s ON s.id = aps.service_id
      JOIN clients c ON c.id = a.client_id
      WHERE c.email = 'client@nogotochki.test'
      ORDER BY a.starts_at
      `,
    )
    .all();
  const plaintextPasswords = Object.fromEntries(
    testUsers().map((user) => [user.email, user.password]),
  );
  const storedPlain = db
    .prepare(
      `
      SELECT COUNT(*) AS n FROM clients
      WHERE email LIKE '%@nogotochki.test'
        AND password_hash IN (?, ?, ?)
      `,
    )
    .get(
      process.env.DEV_ADMIN_PASSWORD,
      process.env.DEV_MASTER_PASSWORD,
      process.env.DEV_CLIENT_PASSWORD,
    );

  const rowCounts = Object.fromEntries(
    COUNT_TABLES.map((table) => [
      table,
      db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n,
    ]),
  );

  console.log("seed:dev complete");
  console.log(`database: ${DATABASE_PATH}`);
  console.log("row_counts", rowCounts);
  console.log("users", users);
  console.log("dev passwords (not stored)", plaintextPasswords);
  console.log("plaintext passwords in db", storedPlain.n);
  console.log("services", services);
  console.log("masters", masters);
  console.log("schedule_rows", schedule.length, schedule);
  console.log("appointments", appointments);
}

export function seedDev() {
  assertDevEnvironment();
  const db = getDb();
  const now = nowUtc();

  runInTransaction(db, () => {
    seedStudioSettings(db, now);
    seedServices(db, now);
    seedMasters(db, now);
    seedMasterServices(db);
    seedMasterSchedule(db, now);
    const ids = upsertUsers(db, now);
    seedAppointments(db, now, ids.client);
  });

  printSummary(db);
}

if (isMainModule(import.meta.url)) {
  seedDev();
  closeDb();
}
