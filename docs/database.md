# База данных «Ноготочки» — реализация

Живой журнал реализации SQLite. Модель таблиц и инварианты — в [`docs/db-schema.md`](db-schema.md). Этот файл — как это устроено в коде, чем пользовались, что ломалось и что нужно на BeGet.

**Для следующей сессии ИИ:** прочитай `cloud.md`, этот файл, затем `docs/db-schema.md`. Не выдумывай таблицу свободных слотов. Не открывай SQLite мимо `server/src/db/connection.js`. HTTP API записи — `server/src/http/` и `server/src/domain/`. Продуктовый клиентский UI — `web/*.html` (Vite только как dev-сервер и прокси `/api`). Черновой hash-UI — `web/src/`, `web/test.html`, не расширяй. Админ-панель: услуги, мастера и записи (`/admin`) живые. Локальный запуск для человека — `README.md`.

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
| [`docs/db-schema.md`](db-schema.md) | Модель: 19 таблиц, статусы, индексы, что не хранить |
| [`server/migrations/001_init.sql`](../server/migrations/001_init.sql) | DDL этих 17 таблиц + UNIQUE + FK + индексы §8 |
| [`server/migrations/003_overlap_override.sql`](../server/migrations/003_overlap_override.sql) | Колонка `overlap_override`; триггер пропускает только NEW=1 |
| [`server/migrations/004_roles.sql`](../server/migrations/004_roles.sql) | `roles`, `client_roles`, `masters.client_id` |
| [`server/migrations/005_appointment_service_snapshots.sql`](../server/migrations/005_appointment_service_snapshots.sql) | `services.is_active`; снимок цены и длительности в `appointment_services` |
| [`server/migrations/006_admin_appointments.sql`](../server/migrations/006_admin_appointments.sql) | Журнал отмены/переноса; `master_time_blocks.kind` |
| [`server/migrations/007_notifications_body.sql`](../server/migrations/007_notifications_body.sql) | `notifications.body`, тип `overlapping` |
| [`server/src/db/connection.js`](../server/src/db/connection.js) | Единственное открытие файла SQLite, `PRAGMA foreign_keys = ON` |
| [`server/src/db/migrate.js`](../server/src/db/migrate.js) | Накат `*.sql` по порядку, учёт в `schema_migrations` |
| [`server/src/db/seed.js`](../server/src/db/seed.js) | Справочники паспорта: 7 услуг, 3 мастера, FAQ/политика |
| [`server/src/db/seed-dev.js`](../server/src/db/seed-dev.js) | Фикстуры разработки: три клиента по email, 5 услуг, 2 мастера, 3 записи |
| [`server/src/db/reset.js`](../server/src/db/reset.js) | Удаляет файл БД и собирает заново. **Не для прода** |
| [`server/src/http/`](../server/src/http/) | Express: сессии, JSON-ошибки, маршруты `/api/*` |
| [`server/src/domain/`](../server/src/domain/) | Расчёт окон §4, холды, записи, роли списком (`client_roles`), без колонки `clients.role` |
| [`web/`](../web/) | Продуктовый клиентский UI: страницы `*.html`, Vite :5173, proxy `/api` → :3000, cookie-сессия |
| `data/nogotochki.sqlite` | Файл базы (в git не входит) |
| [`README.md`](../README.md) | Запуск с нуля: Node, `.env`, API, клиентские экраны |

Файл по умолчанию: `data/nogotochki.sqlite` от корня репозитория. Переопределение: `DATABASE_PATH` в `.env` (относительный путь — тоже от корня).

### Логика экранов → таблицы

| Поток | Таблицы |
|---|---|
| Лендинг, каталоги, FAQ, политика | `studio_settings`, `services`, `masters`, `content_pages` + `content_page_items` |
| Вход / регистрация / сброс пароля | `clients` (`password_hash` опционален; `provider`, `provider_id`), `sessions`, `password_reset_tokens` (хеш токена; reset-HTTP нет) |
| Степпер 1–2 | `services` (`is_bookable`, `is_addon`), `masters` + `master_services` |
| Степпер 3–4, таймер резерва | расчёт окон; выбор пишет `booking_holds` + `booking_hold_services` |
| Подтверждение (нужен вход) | `appointments` сразу `pending_prepayment` + `appointment_services`; холд удаляется |
| Кабинет | те же записи; адрес студии — `studio_settings.exact_address` и **только** при статусе `confirmed` |
| «Сессия истекла» | просроченный `sessions`; состав услуг — живой холд по `hold_token` |

Сертификат в прайсе (`is_bookable = 0`), в степпер не кладётся. Отключённая услуга (`is_active = 0`) не попадает в `GET /api/services` и в запись. Дизайн ногтей — добавка (`is_addon = 1`), не отдельный визит. Имя мастера на экране: `masters.display_name` или «Мастер студии», ФИО не выдумывать. Цена и длительность уже оформленного визита — снимок в `appointment_services`; актуальный прайс — в `services`.

### Даты

- Инстанты (`starts_at`, `expires_at`, `created_at`, …) — ISO 8601 UTC с `Z`, секунды.
- Календарный день студии — `YYYY-MM-DD` в `Europe/Moscow`.
- Часы графика — `HH:MM` в поясе студии, weekday ISO 1=пн … 7=вс.
- Москва без DST: локаль `10:00` = `07:00Z` того же календарного дня.

### Отличие двух сидов

- `npm run seed` — витрина как в паспорте (7 услуг включая сертификат, 3 мастера).
- `npm run seed:dev` — чем проверять сервис: три тестовых аккаунта в `clients` + роли в `client_roles` (колонки `clients.role` нет), пять записываемых услуг, два мастера, график пн–сб 10:00–18:00, три ближайшие записи. `master@nogotochki.test` связан с `masters.id = 1`. Идемпотентен. При `NODE_ENV=production` падает.

В продуктовом UI v1 кабинета сотрудника нет. Авторизация API берёт **список ролей из БД** (`client_roles`), не `ADMIN_EMAILS` и не поле `role` в запросе.

---

## 2. С какими сложностями столкнулись и как решили

| Проблема | Решение |
|---|---|
| В паспорте был ориентир `profiles` / таблица `slots` | Отменён. Клиент — `clients`. Слотов нет, окна считаются. Схема в `docs/db-schema.md`. |
| `better-sqlite3` не собрался на Node 24 (нет prebuild, install-скрипты npm не прогнали native addon, процесс падал) | Перешли на встроенный `node:sqlite` (`DatabaseSync`). На BeGet не нужна сборка node-gyp. |
| У SQLite внешние ключи по умолчанию выключены | В конструкторе `enableForeignKeyConstraints: true` и каждый раз `PRAGMA foreign_keys = ON`. FK в DDL именованные `CONSTRAINT fk_…`. |
| Два гостя могли занять одно окно | Холд в БД, не только `localStorage`. Пересечение интервалов UNIQUE не закрыть — проверка в транзакции `BEGIN IMMEDIATE` (когда появится API записи). |
| Без графика расчёт окон всегда пустой, часов в паспорте нет | Сид пн–сб `10:00`–`18:00`, вс без строк. Это допущение прототипа, не факт паспорта. |
| Тестовые admin/master не из модели UI v1 | Колонку `clients.role` не добавляли. Список ролей — `roles` + `client_roles`. |
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

Дополнительно: WAL, `busy_timeout = 5000`. Пароли: встроенный `crypto.scrypt` / `scryptSync` (чистый Node, без native-аддона). Строка в БД — PHC `$scrypt$N=…$r=…$p=…$salt$hash`, уникальная соль на пароль. bcryptjs снят: на BeGet native bcrypt/argon2 не собираем.

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
- `TRUST_PROXY` — пусто/`0`: IP для rate limit = адрес сокета; `1`: один ближайший хоп (nginx на BeGet). `X-Forwarded-For` без этого не доверяем
- `DEV_ADMIN_PASSWORD` / `DEV_MASTER_PASSWORD` / `DEV_CLIENT_PASSWORD` — только для `seed:dev`, значения в `.env.example`. В БД пишется scrypt, не этот текст
- Роли администратора **не** задаются через `ADMIN_EMAILS`. Источник — `client_roles`

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

Тестовые логины после `seed:dev` (пароли из env / `.env.example`, в БД — scrypt):

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
9. Админ-доступ — роль `administrator` в `client_roles`, не список почт и не колонка `clients.role`.
10. Пересечение визитов одного мастера закрывают триггеры `appointments_no_overlap_*` и `BEGIN IMMEDIATE`. Текст SQLite клиенту не отдаём.
11. Наложение поверх чужого визита — только `overlap_override=1` и роль `administrator` в списке. Чужой INSERT всё равно видит эту запись как занятость.
12. Единственный INSERT записи — `insertAppointment` в `server/src/domain/appointments.js`. Клиентский HTTP: `POST /api/appointments` → `createAppointment`. Перенос — `rescheduleAppointment`, отмена — `cancelAppointment`. Админ создаёт визит существующему клиенту через `POST /api/admin/appointments` (без холда); чужие отмена и перенос — `POST /api/admin/appointments/:id/cancel|reschedule` на той же строке.

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
| 2026-08-26 | Безопасность API: salted scrypt вместо bcryptjs; роли списком (`roles` + `client_roles`, `masters.client_id`); админ не через `ADMIN_EMAILS`; сессия по-прежнему SHA-256 токена; rate limit на login/register; ошибки без текста SQLite. |
| 2026-08-26 | Rate limit login/register ключуется по `req.ip`. `X-Forwarded-For` учитывается только при `TRUST_PROXY`. |
| 2026-08-26 | Черновой тестовый фронтенд в `web/`: Vite + vanilla JS, hash-router (`#/login`, `#/catalog`, `#/availability`, `#/book`, `#/cabinet`, `#/admin`), proxy `/api` → Express :3000, сессия Bearer в `localStorage`. |
| 2026-08-26 | Потоки теста API в UI: регистрация/вход, каталог, слоты, холд + запись, кабинет (детали, перенос, отмена), админка (confirm, CRUD услуг и мастеров). Ошибки API и `SLOT_TAKEN` («Это время уже занято») на странице, не только в консоли. |
| 2026-08-26 | Локально: файл SQLite без миграций 002–004 даёт 500 на `POST /api/appointments` (нет `overlap_override`). Лечение — `npm run migrate` из `server/`. Миграция `004_roles.sql` не проставляет `client_roles` уже существующим клиентам; для чистой машины достаточно `db:dev`. |
| 2026-08-26 | `README.md` в корне: установка Git/Node, `.env` от корня репозитория, два процесса (API и Vite), тестовые учётки. |
| 2026-09-03 | Продуктовый клиентский UI в `web/*.html` (лендинг, auth, степпер записи, кабинет). Hash-черновик `web/src/` не продукт. Админ-панель отложена на следующую итерацию. |
| 2026-09-07 | Каркас админки: HTML `GET /admin`, `/admin/services`, `/admin/masters` (пустые Записи / Услуги / Мастера). Доступ по `hasRole(..., administrator)`: гость — на вход, клиент — 403 HTML «Этот раздел только для администраторов». JSON `/api/admin/*` по-прежнему за `requireAdmin`. CRUD списков в этом срезе нет. |
| 2026-09-07 | Админка услуг и мастеров: список / форма / вкл-выкл / удаление. Миграция `005_appointment_service_snapshots.sql`: `services.is_active`, снимок `price_rub` и `duration_*` в `appointment_services`. DELETE без ссылок стирает строку; при записях или живом холде — отключает и объясняет. Клиенту отключённые позиции в записи не показываются. |
| 2026-09-08 | Услуги и мастера редактируются из админ-панели: `/admin/services` и `/admin/masters` (список, форма, вкл/выкл, удаление). |
| 2026-09-08 | Запись хранит цену и длительность услуги на момент оформления: снимок в `appointment_services` (`price_rub`, `duration_min_minutes`, `duration_max_minutes`). Смена прайса не переписывает уже созданные визиты. |
| 2026-09-08 | Админ-экран записей `/admin`: день студии, фильтр мастера, отмена/перенос чужого визита, блокировки `master_time_blocks`, создание поверх занятого слота после предупреждения. Миграция `006_admin_appointments.sql`. |
| 2026-09-08 | Лента уведомлений кабинета: `GET /api/notifications` + `unread_count`, `POST …/read`. Миграция `007_notifications_body.sql`. Пишутся только админская отмена/перенос и наложение слота. |
| 2026-09-08 | Зафиксированы соответствие админ → кабинет, события ленты и прогон сценариев (см. разделы ниже). Старый процесс API без `body`/`overlapping` давал пустые строки — после перезапуска `:3000` сценарии зелёные. |
| 2026-09-09 | В проект добавлен вход через внешний сервис (Яндекс): миграция `008_oauth_clients.sql` (`password_hash` nullable, `provider` / `provider_id`), `POST /api/auth/yandex`, кнопка на экранах входа/регистрации, check `password-login-available` без reset-HTTP. Локальная проверка — заглушка `YANDEX_OAUTH_STUB`; **перед публикацией и на BeGet заглушку нужно отключить**. |
| 2026-09-10 | Ручная проверка по `docs/test-checklist.md` (гость, клиент, администратор, безопасность; сценарии `[2 окна]` — обычное окно + инкогнито). Результаты записаны в том же файле. Итог: большинство сценариев пройдено; непройдены C17 (нет empty «Нет свободного времени» на переносе) и S3 (при конфликте слота на confirm текст «Резерв истек…» вместо «Это время уже занято»); не реализованы G3 (сертификат / «Условия в студии») и G4 («Дизайн ногтей» на шаге 1). Список находок — в конце чек-листа. Код по итогам прогона не меняли. |

### Админ и чужая запись → что видит клиент

| Действие администратора | Что происходит с записью | Что видит клиент в кабинете |
|---|---|---|
| Подтвердить предоплату | Та же строка → `confirmed` | Активные; адрес студии доступен |
| Отменить (`POST …/cancel`, причина обязательна) | Та же строка → `cancelled`, слот свободен, строка не удаляется | История, бейдж «отменена»; уведомление `cancelled` |
| Перенести (`POST …/reschedule`) | Та же строка, новый интервал, `previous_*`, статус `rescheduled` | Активные, бейдж «перенесена», новое время; уведомление `rescheduled` |
| Создать визит существующему клиенту | Новый `pending_prepayment` без холда | Активные у этого клиента (отдельного «вас записали» нет) |
| Создать поверх занятого слота (`overlap_override`) | Новая строка + пометка «два визита» у пары | Владелец **старой** записи: уведомление `overlapping`; у новой записи о бронировании уведомления нет |
| Блокировка времени мастера | Строка в `master_time_blocks` | Окно пропадает из доступности при записи; своей записи у клиента нет |

Клиентская отмена/перенос своей записи кабинет обновляют как раньше, **без** строк в `notifications`.

### Уведомления: когда создаются

| Событие | Кому | `type` | Пример `body` |
|---|---|---|---|
| Админ отменил чужой визит | `appointment.client_id` | `cancelled` | `Запись на четверг, 14:00 отменена студией.` |
| Админ перенёс чужой визит | владелец записи | `rescheduled` | `Запись на четверг, 14:00 перенесена на пятницу, 11:00.` |
| Админ создал поверх с `overlap_override` | владельцы **уже существующих** пересекающихся визитов (не клиент новой записи; тот же клиент, если оба визита его — без дубля) | `overlapping` | `На ваше время четверг, 14:00 поставили ещё одну запись.` |

Не пишутся: клиентская запись / отмена / перенос, `confirm`, `reserve_expiring`. Лента: `GET /api/notifications` (+ `unread_count`), `POST /api/notifications/:id/read`. Ссылка — `/cabinet-appointment.html?id=…`.

### Проверенные сценарии (2026-09-08)

1. Админ отменил чужую запись → одна строка с текстом «отменена студией», счётчик +1.
2. Админ перенёс чужую запись → одна строка «перенесена на…», та же `appointment_id`.
3. Админ создал поверх занятого времени → уведомление у владельца старой записи; у нового клиента типа `overlapping` нет.
4. Переход по `href` открывает детали нужной записи.
5. После `POST …/read` `unread_count` уменьшается на 1 (клик в UI сначала читает, потом навигирует).
6. Регрессия: `npm test` в `server/` — 37/37.

## HTTP API

Префикс `/api`. Тело и ответы — JSON. Ошибки: `{ "error": { "code", "message" } }` со статусами 400 / 401 / 403 / 409 / 429 (и 404 для неизвестного маршрута или id). Конфликт слота (`SLOT_TAKEN`) дополнительно отдаёт `slots` — ближайшие свободные старты того же мастера, без текста SQLite. Создание записи и перенос идут в `BEGIN IMMEDIATE` (блокировка записи с начала транзакции). Деньги — `price_rub` (целые рубли). Инстанты — UTC с суффиксом `Z`. Сессия: httpOnly cookie `session` и поле `token` в JSON; в БД хранится SHA-256 токена. Пароль — salted scrypt. Клиент в JSON: `roles: string[]` и `is_admin` (true, если в списке есть `administrator`). Истёкшие `booking_holds` удаляются при расчёте окон, холде, записи и раз в минуту в процессе.

| Метод | Путь | Кто | Назначение |
|---|---|---|---|
| GET | `/api/health` | публичный | Жив ли процесс |
| POST | `/api/auth/register` | публичный, rate limit по `req.ip` | Регистрация, сразу сессия, роль `client` |
| POST | `/api/auth/login` | публичный, rate limit по `req.ip` | Вход; при `password_hash` NULL — `YANDEX_LOGIN_ONLY` |
| POST | `/api/auth/yandex` | публичный, rate limit по `req.ip` | Вход/привязка через Яндекс (заглушка по `YANDEX_OAUTH_STUB`); сессия как у login |
| POST | `/api/auth/password-login-available` | публичный, rate limit по `req.ip` | Проверка: есть ли пароль у почты (для «Забыли пароль?»); не reset-API |
| POST | `/api/auth/logout` | сессия | Выход, гасит строку `sessions` |
| GET | `/api/auth/me` | сессия | Текущий клиент без хеша пароля, `roles` |
| GET | `/api/services` | публичный | Прайс, только `is_active = 1` |
| GET | `/api/masters` | публичный | Активные мастера; `service_ids` — умеет весь набор |
| GET | `/api/masters/:id/availability` | публичный | Свободные старты на `date=YYYY-MM-DD` с длительностью услуг |
| POST | `/api/holds` | гость или сессия | Удержать слот на `reserve_minutes` |
| GET | `/api/holds/:token` | по токену | Сводка черновика |
| DELETE | `/api/holds/:token` | по токену | Снять резерв |
| POST | `/api/appointments` | сессия | Подтвердить холд → `pending_prepayment` |
| GET | `/api/appointments` | сессия | Записи по объединению ролей, `scope=active\|history` |
| GET | `/api/appointments/:id` | сессия + право видеть | Детали; адрес только при `confirmed` |
| POST | `/api/appointments/:id/reschedule` | владелец | Перенос той же строки |
| POST | `/api/appointments/:id/cancel` | владелец | Отмена по правилу §5.1 |
| GET | `/api/notifications` | сессия | Лента кабинета + `unread_count` |
| POST | `/api/notifications/:id/read` | владелец строки | Пометить прочитанным |
| GET | `/api/admin/appointments` | роль `administrator` | Все записи или день `date` + `master_id`; ещё `time_blocks`, `timezone` |
| POST | `/api/admin/appointments` | роль `administrator` | Создать визит существующему клиенту (`client_email`); `overlap_override` после 409 |
| PATCH | `/api/admin/appointments/:id` | роль `administrator` | `status=confirmed` |
| POST | `/api/admin/appointments/:id/cancel` | роль `administrator` | Отмена чужой записи (`reason`); строка остаётся |
| POST | `/api/admin/appointments/:id/reschedule` | роль `administrator` | Перенос той же строки |
| POST/DELETE | `/api/admin/time-blocks` | роль `administrator` | Перерыв / выходной / отпуск мастера |
| GET/POST/PATCH/DELETE | `/api/admin/services` | роль `administrator` | Прайс |
| GET/POST/PATCH/DELETE | `/api/admin/masters` | роль `administrator` | Мастера, `service_ids`, график |

## Открытые вопросы

- Прод: один процесс Node на BeGet, путь к файлу БД вне деплоя, бэкап файла. Не Vercel.
- Кабинет сотрудника как отдельный продукт по-прежнему вне v1. Не добавлять `clients.role`; роли — список в `client_roles`.
- Клиентский UI собран в `web/*.html`. Каркас `/admin` закрыт ролью `administrator`. Услуги, мастера и записи наполнены.
