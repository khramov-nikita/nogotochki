import { isMainModule } from "./cli.js";
import { DATABASE_PATH, closeDb, getDb, runInTransaction } from "./connection.js";

function nowUtc() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function seedStudioSettings(db, now) {
  db.prepare(
    `
    INSERT OR IGNORE INTO studio_settings (
      id,
      display_name,
      kicker,
      hero_image_path,
      public_location,
      exact_address,
      timezone,
      calendar_horizon_days,
      slot_step_minutes,
      min_lead_minutes,
      reserve_minutes,
      established_year,
      regular_clients_count,
      cancel_min_hours_before,
      reschedule_min_hours_before,
      reminder_hours_before,
      created_at,
      updated_at
    ) VALUES (
      1,
      'Ноготочки',
      'Студия маникюра и бровей',
      NULL,
      'центр города',
      NULL,
      'Europe/Moscow',
      56,
      30,
      0,
      15,
      2019,
      400,
      NULL,
      NULL,
      NULL,
      ?,
      ?
    )
    `,
  ).run(now, now);
}

function seedServices(db, now) {
  const insert = db.prepare(
    `
    INSERT OR IGNORE INTO services (
      id,
      slug,
      name,
      description,
      price_rub,
      price_rub_alt,
      duration_min_minutes,
      duration_max_minutes,
      is_addon,
      is_bookable,
      validity_months,
      image_path,
      sort_order,
      created_at,
      updated_at
    ) VALUES (
      @id, @slug, @name, NULL, @price_rub, @price_rub_alt,
      @duration_min_minutes, @duration_max_minutes,
      @is_addon, @is_bookable, @validity_months, NULL,
      @sort_order, @created_at, @updated_at
    )
    `,
  );

  const rows = [
    {
      id: 1,
      slug: "manicure_gel",
      name: "Маникюр с покрытием гель-лаком",
      price_rub: 1800,
      price_rub_alt: null,
      duration_min_minutes: 90,
      duration_max_minutes: 90,
      is_addon: 0,
      is_bookable: 1,
      validity_months: null,
      sort_order: 1,
    },
    {
      id: 2,
      slug: "manicure_pedicure",
      name: "Маникюр и педикюр",
      price_rub: 3200,
      price_rub_alt: null,
      duration_min_minutes: 150,
      duration_max_minutes: 150,
      is_addon: 0,
      is_bookable: 1,
      validity_months: null,
      sort_order: 2,
    },
    {
      id: 3,
      slug: "extension",
      name: "Наращивание ногтей",
      price_rub: 2800,
      price_rub_alt: null,
      duration_min_minutes: 150,
      duration_max_minutes: 150,
      is_addon: 0,
      is_bookable: 1,
      validity_months: null,
      sort_order: 3,
    },
    {
      id: 4,
      slug: "nail_design",
      name: "Дизайн ногтей",
      price_rub: 300,
      price_rub_alt: null,
      duration_min_minutes: 15,
      duration_max_minutes: 30,
      is_addon: 1,
      is_bookable: 1,
      validity_months: null,
      sort_order: 4,
    },
    {
      id: 5,
      slug: "brow_correction",
      name: "Коррекция и окрашивание бровей",
      price_rub: 1200,
      price_rub_alt: null,
      duration_min_minutes: 40,
      duration_max_minutes: 40,
      is_addon: 0,
      is_bookable: 1,
      validity_months: null,
      sort_order: 5,
    },
    {
      id: 6,
      slug: "brow_lamination",
      name: "Ламинирование бровей",
      price_rub: 1800,
      price_rub_alt: null,
      duration_min_minutes: 60,
      duration_max_minutes: 60,
      is_addon: 0,
      is_bookable: 1,
      validity_months: null,
      sort_order: 6,
    },
    {
      id: 7,
      slug: "gift_certificate",
      name: "Подарочный сертификат",
      price_rub: 3000,
      price_rub_alt: 5000,
      duration_min_minutes: null,
      duration_max_minutes: null,
      is_addon: 0,
      is_bookable: 0,
      validity_months: 6,
      sort_order: 7,
    },
  ];

  for (const row of rows) {
    insert.run({ ...row, created_at: now, updated_at: now });
  }
}

function seedMasters(db, now) {
  const insert = db.prepare(
    `
    INSERT OR IGNORE INTO masters (
      id,
      display_name,
      specialization_label,
      portrait_path,
      cover_path,
      is_active,
      sort_order,
      created_at,
      updated_at
    ) VALUES (
      @id, NULL, @specialization_label, NULL, NULL, 1, @sort_order, @created_at, @updated_at
    )
    `,
  );

  const rows = [
    { id: 1, specialization_label: "Маникюр и покрытие", sort_order: 1 },
    { id: 2, specialization_label: "Педикюр и комплексы", sort_order: 2 },
    { id: 3, specialization_label: "Брови", sort_order: 3 },
  ];

  for (const row of rows) {
    insert.run({ ...row, created_at: now, updated_at: now });
  }
}

function seedMasterServices(db) {
  const insert = db.prepare(
    `
    INSERT OR IGNORE INTO master_services (master_id, service_id)
    VALUES (?, ?)
    `,
  );

  const pairs = [
    [1, 1],
    [1, 3],
    [1, 4],
    [2, 2],
    [2, 1],
    [2, 4],
    [3, 5],
    [3, 6],
  ];

  for (const [masterId, serviceId] of pairs) {
    insert.run(masterId, serviceId);
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

  for (const masterId of [1, 2, 3]) {
    for (let weekday = 1; weekday <= 6; weekday += 1) {
      insert.run(masterId, weekday, now);
    }
  }
}

function seedContent(db, now) {
  const insertPage = db.prepare(
    `
    INSERT OR IGNORE INTO content_pages (slug, title, body, created_at, updated_at)
    VALUES (@slug, @title, @body, @created_at, @updated_at)
    `,
  );

  const pages = [
    { slug: "faq", title: "Вопросы и ответы", body: null },
    {
      slug: "privacy",
      title: "Политика конфиденциальности",
      body: "Сайт резервирует слот и ведёт кабинет. Предоплату принимает студия, не этот сервис. Юридический адрес, ИНН, телефон и email студии здесь не публикуем.",
    },
    {
      slug: "cancellation_rules",
      title: "Правила отмены и переноса",
      body: "Отменить или перенести запись можно в кабинете. Дедлайны в часах и штрафы на сайте не публикуем.",
    },
    {
      slug: "gift_certificate",
      title: "Подарочный сертификат",
      body: "Сертификат покупают в студии. К онлайн-записи на слот он не относится.",
    },
  ];

  for (const page of pages) {
    insertPage.run({ ...page, created_at: now, updated_at: now });
  }

  const pageIdBySlug = Object.fromEntries(
    db
      .prepare("SELECT id, slug FROM content_pages")
      .all()
      .map((row) => [row.slug, row.id]),
  );

  const insertItem = db.prepare(
    `
    INSERT OR IGNORE INTO content_page_items (
      page_id, question, answer, sort_order, created_at
    ) VALUES (?, ?, ?, ?, ?)
    `,
  );

  const items = [
    {
      slug: "faq",
      question: "Как отменить запись?",
      answer: "В кабинете, без звонка в студию.",
      sort_order: 1,
    },
    {
      slug: "faq",
      question: "Как оплатить визит?",
      answer:
        "Сайт не принимает оплату. Полную предоплату берёт студия вне сервиса.",
      sort_order: 2,
    },
    {
      slug: "faq",
      question: "Можно ли прийти без записи?",
      answer: "Нет. Приём только по предварительной записи, выезда нет.",
      sort_order: 3,
    },
    {
      slug: "faq",
      question: "Где находится студия?",
      answer:
        "Публично — центр города. Точный адрес появится в кабинете после подтверждения записи.",
      sort_order: 4,
    },
    {
      slug: "privacy",
      question: "Какие данные нужны для входа?",
      answer: "Почта и пароль. Открытый пароль в базе не хранится.",
      sort_order: 1,
    },
    {
      slug: "privacy",
      question: "Какие данные нужны для записи?",
      answer: "Услуги, мастер и выбранный слот.",
      sort_order: 2,
    },
    {
      slug: "privacy",
      question: "Принимает ли сайт оплату?",
      answer: "Нет. Предоплату принимает студия вне этого сервиса.",
      sort_order: 3,
    },
    {
      slug: "privacy",
      question: "Показываете ли вы точный адрес?",
      answer:
        "Публично — «центр города». Точный адрес — в кабинете после статуса «подтверждена».",
      sort_order: 4,
    },
    {
      slug: "privacy",
      question: "Какие уведомления вы отправляете?",
      answer:
        "Данные аккаунта, резерва и уведомлений живут в кабинете. SMS не используем.",
      sort_order: 5,
    },
    {
      slug: "cancellation_rules",
      question: "Как отменить запись?",
      answer: "Откройте запись в кабинете и подтвердите отмену.",
      sort_order: 1,
    },
    {
      slug: "cancellation_rules",
      question: "Как перенести запись?",
      answer: "В кабинете выберите другое свободное время у мастера.",
      sort_order: 2,
    },
  ];

  for (const item of items) {
    insertItem.run(
      pageIdBySlug[item.slug],
      item.question,
      item.answer,
      item.sort_order,
      now,
    );
  }
}

export function seed() {
  const db = getDb();
  const now = nowUtc();
  runInTransaction(db, () => {
    seedStudioSettings(db, now);
    seedServices(db, now);
    seedMasters(db, now);
    seedMasterServices(db);
    seedMasterSchedule(db, now);
    seedContent(db, now);
  });

  const counts = {
    studio_settings: db.prepare("SELECT COUNT(*) AS n FROM studio_settings").get().n,
    services: db.prepare("SELECT COUNT(*) AS n FROM services").get().n,
    masters: db.prepare("SELECT COUNT(*) AS n FROM masters").get().n,
    master_schedule: db.prepare("SELECT COUNT(*) AS n FROM master_schedule").get().n,
    content_pages: db.prepare("SELECT COUNT(*) AS n FROM content_pages").get().n,
    content_page_items: db
      .prepare("SELECT COUNT(*) AS n FROM content_page_items")
      .get().n,
  };

  console.log("seed complete", counts);
  console.log(`database: ${DATABASE_PATH}`);
}

if (isMainModule(import.meta.url)) {
  seed();
  closeDb();
}
