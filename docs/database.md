# База данных «Ноготочки» — реализация

Живой журнал реализации SQLite. Модель таблиц и инварианты — в [`docs/db-schema.md`](db-schema.md). Этот файл — как это устроено в коде, чем пользовались, что ломалось и что нужно на BeGet.

**Для следующей сессии ИИ:** прочитай `cloud.md`, этот файл, затем `docs/db-schema.md`. Не выдумывай таблицу свободных слотов. Не открывай SQLite мимо `server/src/db/connection.js`. HTTP API и фронтенд в этом срезе ещё не писали.

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
| [`server/migrations/002_clients_role.sql`](../server/migrations/002_clients_role.sql) | `clients.role` для **тестовых** логинов admin/master/client |
| [`server/src/db/connection.js`](../server/src/db/connection.js) | Единственное открытие файла SQLite, `PRAGMA foreign_keys = ON` |
| [`server/src/db/migrate.js`](../server/src/db/migrate.js) | Накат `*.sql` по порядку, учёт в `schema_migrations` |
| [`server/src/db/seed.js`](../server/src/db/seed.js) | Справочники паспорта: 7 услуг, 3 мастера, FAQ/политика |
| [`server/src/db/seed-dev.js`](../server/src/db/seed-dev.js) | Фикстуры разработки: роли, 5 услуг, 2 мастера, 3 записи |
| [`server/src/db/reset.js`](../server/src/db/reset.js) | Удаляет файл БД и собирает заново. **Не для прода** |
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
- `npm run seed:dev` — чем проверять сервис: три логина с ролями, пять записываемых услуг, два мастера, график пн–сб 10:00–18:00, три ближайшие записи. Идемпотентен. При `NODE_ENV=production` падает.

В продукте v1 кабинета сотрудника нет. `clients.role` (`client` / `master` / `admin`) заведён **только** чтобы тестовые логины отличались. Не строить на этом админку, пока человек явно не попросит.

---

## 2. С какими сложностями столкнулись и как решили

| Проблема | Решение |
|---|---|
| В паспорте был ориентир `profiles` / таблица `slots` | Отменён. Клиент — `clients`. Слотов нет, окна считаются. Схема в `docs/db-schema.md`. |
| `better-sqlite3` не собрался на Node 24 (нет prebuild, install-скрипты npm не прогнали native addon, процесс падал) | Перешли на встроенный `node:sqlite` (`DatabaseSync`). На BeGet не нужна сборка node-gyp. |
| У SQLite внешние ключи по умолчанию выключены | В конструкторе `enableForeignKeyConstraints: true` и каждый раз `PRAGMA foreign_keys = ON`. FK в DDL именованные `CONSTRAINT fk_…`. |
| Два гостя могли занять одно окно | Холд в БД, не только `localStorage`. Пересечение интервалов UNIQUE не закрыть — проверка в транзакции `BEGIN IMMEDIATE` (когда появится API записи). |
| Без графика расчёт окон всегда пустой, часов в паспорте нет | Сид пн–сб `10:00`–`18:00`, вс без строк. Это допущение прототипа, не факт паспорта. |
| Тестовые admin/master не из модели v1 | Миграция `002_clients_role.sql`. Пароль всё равно только bcrypt-хеш (`bcryptjs`, без native). |
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
- `PORT` — зарезервирован, HTTP ещё нет

---

## Команды (из каталога `server/`)

```bash
npm run migrate     # накатить новые SQL
npm run seed        # справочники паспорта
npm run seed:dev    # фикстуры разработки (идемпотентно)
npm run db:setup    # migrate + seed
npm run db:dev      # migrate + seed:dev
npm run db:reset    # удалить файл БД и собрать заново; не для прода
npm run db:schema   # печать живых таблиц и FK
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
7. API, когда появится, импортирует `getDb()`, не открывает файл сам.
8. Дополняй **этот** файл, а не размазывай те же факты по пяти markdown.

---

## Журнал

| Дата | Что сделали |
|---|---|
| 2026-08-26 | Каркас `server/`: connection, `001_init.sql` (17 таблиц), migrate/seed/reset. Драйвер `node:sqlite`. |
| 2026-08-26 | Отказ от `better-sqlite3` (Node 24 / BeGet). Требование Node ≥ 22.16. |
| 2026-08-26 | `002_clients_role.sql`, `seed-dev.js` (bcryptjs), `.gitignore` для `.env` и файла SQLite. |
| 2026-08-26 | Этот документ заведён как журнал реализации. |

## Открытые вопросы

- HTTP API (холд, подтверждение записи, сессии) ещё нет.
- Расчёт свободных окон в коде ещё нет — алгоритм в `docs/db-schema.md` §4.
- Прод: один процесс Node на BeGet, путь к файлу БД вне деплоя, бэкап файла. Не Vercel.
- Админка и роли как продукт — вне v1; `clients.role` только для фикстур.
