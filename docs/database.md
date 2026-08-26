# База данных «Ноготочки» — реализация

Живой журнал реализации SQLite. Модель таблиц и инварианты — в [`docs/db-schema.md`](db-schema.md). Этот файл — как это устроено в коде, чем пользовались, что ломалось и что нужно на BeGet.

**Для следующей сессии ИИ:** прочитай `cloud.md`, этот файл, затем `docs/db-schema.md`. Не выдумывай таблицу свободных слотов. Не открывай SQLite мимо `server/src/db/connection.js`. HTTP API записи — `server/src/http/` и `server/src/domain/`. Фронтенд в этом срезе не собирали.

Дополняй разделы «Журнал» и «Открытые вопросы» по мере работы. Не копируй сюда полный DDL — он в миграциях.

---

## 1. Как устроена база и как это связано с логикой продукта

Прототип — запись в студию без оплаты на сайте. База нужна, чтобы каталог, мастера, холд слота, записи кабинета и сессии были одними и теми же у всех клиентов. Свободное время **не хранится**: его считает код в момент шага 3 / карточки мастера / переноса.

```text
свободные интервалы =
  master_schedule (этот weekday)
  − appointments (pending_prepayment | confirmed | rescheduled)
  − master_time_blocks
  − живые booking_holds (expires_at > now)
  + отсечение studio_closures и min_lead_minutes
```

Интервалы полуоткрытые `[start, end)`. Нарезки «готовых слотов» в таблицу нет и заводить нельзя.

### Слои в репозитории

| Путь | Роль |
|---|---|
| [`docs/db-schema.md`](db-schema.md) | Модель: 17 таблиц, статусы, индексы, что не хранить |
| [`server/migrations/001_init.sql`](../server/migrations/001_init.sql) | DDL этих 17 таблиц + UNIQUE + FK + индексы §8 |
| [`server/migrations/003_overlap_override.sql`](../server/migrations/003_overlap_override.sql) | Колонка `overlap_override`; триггер пропускает только NEW=1 |
| [`server/src/db/connection.js`](../server/src/db/connection.js) | Единственное открытие файла SQLite, `PRAGMA foreign_keys = ON` |
| [`server/src/db/migrate.js`](../server/src/db/migrate.js) | Накат `*.sql` по порядку, учёт в `schema_migrations` |
| [`server/src/db/seed.js`](../server/src/db/seed.js) | Справочники паспорта: 7 услуг, 3 мастера, FAQ/политика |
| [`server/src/db/seed-dev.js`](../server/src/db/seed-dev.js) | Фикстуры разработки: три клиента по email, 5 услуг, 2 мастера, 3 записи |
| [`server/src/db/reset.js`](../server/src/db/reset.js) | Удаляет файл БД и собирает заново. **Не для прода** |
| [`server/src/http/`](../server/src/http/) | Express: сессии, JSON-ошибки, маршруты `/api/*` |
| [`server/src/domain/`](../server/src/domain/) | Расчёт окон §4, холды, записи, админ без колонки `role` |
| `data/nogotochki.sqlite` | Файл базы (в git не входит) |

Файл по умолчанию: `data/nogotochki.sqlite` от корня репозитория. Переопределение: `DATABASE_PATH` в `.env` (относительный путь — тоже от корня).

### Логика экранов → таблицы

| Поток | Таблицы |
|---|---|
| Лендинг, каталоги, FAQ, политика | `studio_settings`, `services`, `masters`, `content_pages` + `content_page_items` |
| Вход / регистрация / сброс пароля | `clients` (`password_hash` только), `sessions`, `password_reset_tokens` (хеш токена) |
| Степпер 1–2 | `services` (`is_bookable`, `is_addon`), `masters` + `master_services` |
| Степпер 3–4, таймер резерва | расчёт окон; выбор пишет `booking_holds` + `booking_hold_services` |
| Подтверждение (нужен вход) | `appointments` сразу `pending_prepayment` + `appointment_services`; холд удаляется |
| Кабинет | те же записи; адрес студии — `studio_settings.exact_address` и **только** при статусе `confirmed` |
| «Сессия истекла» | просроченный `sessions`; состав услуг — живой холд по `hold_token` |

Сертификат в прайсе (`is_bookable = 0`), в степпер не кладётся. Дизайн ногтей — добавка (`is_addon = 1`), не отдельный визит. Имя мастера на экране: `masters.display_name` или «Мастер студии», ФИО не выдумывать. Цену и длительность визита не копировать в запись — JOIN на `services`.

### Даты

- Инстанты (`starts_at`, `expires_at`, `created_at`, …) — ISO 8601 UTC с `Z`, секунды.
- Календарный день студии — `YYYY-MM-DD` в `Europe/Moscow`.
- Часы графика — `HH:MM` в поясе студии, weekday ISO 1=пн … 7=вс.
- Москва без DST: локаль `10:00` = `07:00Z` того же календарного дня.

### Отличие двух сидов

- `npm run seed` — витрина как в паспорте (7 услуг включая сертификат, 3 мастера).
- `npm run seed:dev` — чем проверять сервис: три тестовых аккаунта в `clients` (различаются email, колонки role нет), пять записываемых услуг, два мастера, график пн–сб 10:00–18:00, три ближайшие записи. Идемпотентен. При `NODE_ENV=production` падает.

В продукте v1 кабинета сотрудника и колонки `clients.role` нет. Тестовые «админ» и «мастер» — обычные строки `clients` с другой почтой, не роли в схеме.

---

## 2. С какими сложностями столкнулись и как решили

| Проблема | Решение |
|---|---|
| В паспорте был ориентир `profiles` / таблица `slots` | Отменён. Клиент — `clients`. Слотов нет, окна считаются. Схема в `docs/db-schema.md`. |
| `better-sqlite3` не собрался на Node 24 (нет prebuild, install-скрипты npm не прогнали native addon, процесс падал) | Перешли на встроенный `node:sqlite` (`DatabaseSync`). На BeGet не нужна сборка node-gyp. |
| У SQLite внешние ключи по умолчанию выключены | В конструкторе `enableForeignKeyConstraints: true` и каждый раз `PRAGMA foreign_keys = ON`. FK в DDL именованные `CONSTRAINT fk_…`. |
| Два гостя могли занять одно окно | Холд в БД, не только `localStorage`. Пересечение интервалов UNIQUE не закрыть — проверка в транзакции `BEGIN IMMEDIATE` (когда появится API записи). |
| Без графика расчёт окон всегда пустой, часов в паспорте нет | Сид пн–сб `10:00`–`18:00`, вс без строк. Это допущение прототипа, не факт паспорта. |
| Тестовые admin/master не из модели v1 | Колонку `role` не добавляли: три строки в `clients` с разной почтой. Админки в схеме нет. |
| Повторный `seed:dev` после каталожного сида оставлял мастеру 2 чужую спеку | Для мастеров 1–2 — `ON CONFLICT(id) DO UPDATE`. Записи ищутся по `(client_id, master_id, starts_at)`. |
| Файл БД и секреты не должны уехать в git | `.gitignore`: `.env`, `*.sqlite` и WAL/SHM. В репозитории остаются `.env.example` и `data/.gitkeep`. |
| `db:reset` на проде уничтожит клиентов | Команда только для локалки. На BeGet: `migrate`, не `reset`. `seed:dev` при production отключён. |

SQLite на **Vercel / serverless** для живой записи не подходит (эфемерный диск, несколько инстансов). Прод этого среза — **один процесс на VPS BeGet**, файл на постоянном диске вне каталога деплоя.

---

## 3. Драйвер SQLite и почему такой

Используется **встроенный модуль Node.js `node:sqlite`**, класс `DatabaseSync`.

Почему не `better-sqlite3` / `sqlite3`:

- синхронный API без промисов вокруг каждого запроса, удобно для миграций и одного процесса;
- нет native-аддона: на BeGet часто нет Visual Studio / Python для `node-gyp`;
- `PRAGMA` и транзакции те же, что у обычного SQLite.

Подключение только из `server/src/db/connection.js`. Версию Node проверяет `server/src/db/engine.js` **до** динамического `import("node:sqlite")`, чтобы на старой Node была понятная ошибка, а не `ERR_UNKNOWN_BUILTIN_MODULE`.

Дополнительно: WAL, `busy_timeout = 5000`. Пароли: `bcryptjs` (чистый JS, тот же довод про BeGet). Схема допускает Argon2id — не подключали, чтобы снова не тащить native.

`server/.npmrc` содержит `engine-strict=true`: `npm ci` на слишком старой Node сразу откажется.

---

## 4. Версия Node.js (BeGet)

**Нужна Node.js 22.16 или новее.** Предпочтительно свежий **22 LTS (≥ 22.16)** или **24**.

| Версия | Что будет |
|---|---|
| &lt; 22.5 | Нет `node:sqlite` |
| 22.5–22.12 | Модуль за флагом `--experimental-sqlite` |
| **22.13+** | Флаг не нужен, модуль ещё experimental |
| **22.16+** | Есть опция `timeout` у `DatabaseSync` — нижняя граница проекта |
| 24.x | Проверено локально (24.19), модуль работает без флага |

На BeGet: в панели сайта выбрать Node 22/24 либо на VPS `nvm install 22`. Затем:

```bash
cd server
node -v    # v22.16+ или v24
npm ci
npm run migrate
```

Первый раз для витрины: `npm run seed`. Для разработки логинов и записей: `npm run seed:dev` (не в production).

Переменные (имена в `.env.example`, без секретов в git):

- `DATABASE_PATH` — абсолютный путь на диске хостинга, не OneDrive и не каталог, который затирает деплой
- `NODE_ENV=production` на проде
- `PORT` — HTTP API, по умолчанию `3000`
- `CORS_ORIGIN` — точный origin, если фронту нужны cookie; пусто — отражать Origin
- `SESSION_DAYS` — срок сессии, по умолчанию `30`
- `ADMIN_EMAILS` — почты с доступом к `/api/admin/*`, по умолчанию `admin@nogotochki.test`. Колонки `clients.role` нет

---

## Команды (из каталога `server/`)

```bash
npm run migrate     # накатить новые SQL
npm run seed        # справочники паспорта
npm run seed:dev    # фикстуры разработки (идемпотентно)
npm run db:setup    # migrate + seed
npm run db:dev      # migrate + seed:dev
npm run db:reset    # удалить локальный файл БД и накатить все миграции; не для прода
npm run db:schema   # печать живых таблиц и FK
npm start           # HTTP API (PORT, по умолчанию 3000)
npm test            # расчёт окон + сценарии /api
```

Тестовые логины после `seed:dev` (пароли только в консоли скрипта, в БД — bcrypt):

- `admin@nogotochki.test`
- `master@nogotochki.test`
- `client@nogotochki.test`

---

## Инварианты для следующих агентов

1. Не создавать `slots` / `time_slots` / `free_slots`.
2. Не добавлять колонки открытого пароля. В логах прода пароль не писать.
3. Не копировать в `appointments` имя мастера, сумму, адрес, текст уведомления.
4. `PRAGMA foreign_keys = ON` на каждом соединении.
5. Новый SQL — новый файл в `server/migrations/`, не переписывать уже применённый `001_init.sql` на живой базе без `db:reset`.
6. Пишущий SQL к данным человека — только по явной просьбе; сначала показать запрос.
7. API импортирует `getDb()`, не открывает файл сам.
8. Дополняй **этот** файл, а не размазывай те же факты по пяти markdown.
9. Админ-доступ — список почт `ADMIN_EMAILS`, не колонка `role`.
10. Пересечение визитов одного мастера закрывают триггеры `appointments_no_overlap_*` и `BEGIN IMMEDIATE`. Текст SQLite клиенту не отдаём.
11. Наложение поверх чужого визита — только `overlap_override=1` и `isAdminEmail`. Чужой INSERT всё равно видит эту запись как занятость.
12. Единственный INSERT записи — `insertAppointment` в `server/src/domain/appointments.js`. Клиентский HTTP: `POST /api/appointments` → `createAppointment`. Перенос — `rescheduleAppointment`, отмена — `cancelAppointment`. Кабинета мастера и админской отмены/переноса чужих визитов в паспорте нет — не добавлять.

---

## Журнал

| Дата | Что сделали |
|---|---|
| 2026-08-26 | Каркас `server/`: connection, `001_init.sql` (17 таблиц), migrate/seed/reset. Драйвер `node:sqlite`. |
| 2026-08-26 | Отказ от `better-sqlite3` (Node 24 / BeGet). Требование Node ≥ 22.16. |
| 2026-08-26 | `seed-dev.js` (bcryptjs), `.gitignore` для `.env` и файла SQLite. |
| 2026-08-26 | Этот документ заведён как журнал реализации. |
| 2026-08-26 | Сверка со схемой: убраны `002_clients_role.sql` и `clients.role` — в `docs/db-schema.md` этой колонки нет. |
| 2026-08-26 | `db:reset` только удаляет локальный файл и накатывает миграции, без сидов. |
| 2026-08-26 | Закрепили `engines.node` `>=22.16` в `server/package.json` (`timeout` у `DatabaseSync`; с 22.13 флаг не нужен). На BeGet ставить Node 22 LTS ≥ 22.16 или Node 24. |
| 2026-08-26 | HTTP API записи: Express в `server/src/http/`, расчёт окон без таблицы слотов, холды с `reserve_minutes`, сессии cookie+Bearer, админ по `ADMIN_EMAILS`. |
| 2026-08-26 | Двойная запись: триггеры `002_appointment_overlap.sql` (`APPOINTMENT_OVERLAP`), создание/перенос в `BEGIN IMMEDIATE`, API отдаёт 409 без текста SQLite и ближайшие слоты. |
| 2026-08-26 | Админ может сесть поверх визита: `003_overlap_override.sql`, флаг только если `isAdminEmail`; клиентский `overlap_override` игнорируется. |
| 2026-08-26 | Запись в БД только через `insertAppointment`: API, seed-dev и overlap-тесты. Перенос/отмена — `rescheduleAppointment` / `cancelAppointment`. |
| 2026-08-26 | Сверка с паспортом и «Путём клиента»: создание, отмена и перенос — сценарии клиента (3 и 4). Кабинета сотрудника, отмены/переноса чужих визитов мастером или админом в v1 нет — не реализовывали. `.gitattributes`: текст в LF. |

## HTTP API

Префикс `/api`. Тело и ответы — JSON. Ошибки: `{ "error": { "code", "message" } }` со статусами 400 / 401 / 403 / 409 (и 404 для неизвестного маршрута или id). Конфликт слота (`SLOT_TAKEN`) дополнительно отдаёт `slots` — ближайшие свободные старты того же мастера, без текста SQLite. Создание записи и перенос идут в `BEGIN IMMEDIATE` (блокировка записи с начала транзакции). Деньги — `price_rub` (целые рубли). Инстанты — UTC с суффиксом `Z`. Сессия: httpOnly cookie `session` и поле `token` в JSON; в БД хранится SHA-256 токена. Истёкшие `booking_holds` удаляются при расчёте окон, холде, записи и раз в минуту в процессе.

| Метод | Путь | Кто | Назначение |
|---|---|---|---|
| GET | `/api/health` | публичный | Жив ли процесс |
| POST | `/api/auth/register` | публичный | Регистрация, сразу сессия |
| POST | `/api/auth/login` | публичный | Вход |
| POST | `/api/auth/logout` | сессия | Выход, гасит строку `sessions` |
| GET | `/api/auth/me` | сессия | Текущий клиент без хеша пароля |
| GET | `/api/services` | публичный | Прайс |
| GET | `/api/masters` | публичный | Активные мастера; `service_ids` — умеет весь набор |
| GET | `/api/masters/:id/availability` | публичный | Свободные старты на `date=YYYY-MM-DD` с длительностью услуг |
| POST | `/api/holds` | гость или сессия | Удержать слот на `reserve_minutes` |
| GET | `/api/holds/:token` | по токену | Сводка черновика |
| DELETE | `/api/holds/:token` | по токену | Снять резерв |
| POST | `/api/appointments` | сессия | Подтвердить холд → `pending_prepayment` |
| GET | `/api/appointments` | сессия | Свои записи, `scope=active\|history` |
| GET | `/api/appointments/:id` | владелец | Детали; адрес только при `confirmed` |
| POST | `/api/appointments/:id/reschedule` | владелец | Перенос той же строки |
| POST | `/api/appointments/:id/cancel` | владелец | Отмена по правилу §5.1 |
| GET | `/api/admin/appointments` | `ADMIN_EMAILS` | Все записи |
| PATCH | `/api/admin/appointments/:id` | `ADMIN_EMAILS` | `status=confirmed` |
| GET/POST/PATCH/DELETE | `/api/admin/services` | `ADMIN_EMAILS` | Прайс |
| GET/POST/PATCH/DELETE | `/api/admin/masters` | `ADMIN_EMAILS` | Мастера, `service_ids`, график |

## Открытые вопросы

- Прод: один процесс Node на BeGet, путь к файлу БД вне деплоя, бэкап файла. Не Vercel.
- Кабинет сотрудника как отдельный продукт по-прежнему вне v1. Не добавлять `clients.role`.
- Фронтенд на этом API ещё не собирали.
