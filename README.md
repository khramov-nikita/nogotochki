# Ноготочки

Веб-сервис записи в бьюти-студию: клиент выбирает услуги и мастера, резервирует слот и управляет визитом. Оплаты на сайте нет — предоплату принимает студия вне сервиса.

В репозитории — HTTP API (Express + SQLite) и **продуктовый клиентский интерфейс** (обычные HTML-страницы в `web/`, не React и не hash-черновик). Есть админ-панель `/admin`. Макеты — в Figma; код пишется сюда.

- Репозиторий: https://github.com/khramov-nikita/nogotochki (private, ветка `main`)
- Опубликованный адрес: **https://nogotochki-test.ru** (Coolify + Docker, HTTPS)

## Какие экраны собраны

Клиентский UI — страницы `web/*.html`. Локально открывать через Vite на http://localhost:5173/ , не двойным щелчком по файлу. На проде те же файлы отдаёт Node вместе с API.

| Срез | Страницы | Что умеет |
|---|---|---|
| Лендинг | `index.html` | Hero, прайс и мастера с API, FAQ, CTA в запись |
| Вход и регистрация | `auth.html`, `register.html` | Cookie-сессия; кнопка «Войти с Яндекс ID» (настоящий OAuth). После входа с живым холдом — на проверку записи, иначе в кабинет |
| Восстановление пароля | `auth-reset-sent.html`, `auth-new-password.html`, `auth-password-changed.html` | HTML есть; reset-HTTP ещё нет. У аккаунта без пароля «Забыли пароль?» показывает текст про вход через Яндекс |
| Запись, шаги 1–5 | `booking.html` → `booking-master.html` → `booking-datetime.html` → `booking-review.html` → `booking-done.html` | Услуги, мастер, дата/время с холдом и таймером, проверка (гость / сессия), успех. «Слот занят» и «резерв истёк» — на тех же страницах |
| Кабинет | `cabinet.html`, `cabinet-appointment.html`, `cabinet-reschedule.html`, `cabinet-rules.html`, `cabinet-notifications.html` | Активные / история / пустой список, детали, отмена, перенос, правила, лента уведомлений |
| Админка | `/admin`, `/admin/services`, `/admin/masters` | Записи дня, отмена/перенос, блокировки времени; CRUD услуг и мастеров. Клиент по прямому адресу получает «Этот раздел только для администраторов» |

Ещё нет отдельных HTML: каталог услуг/мастеров, карточка мастера, политика, служебные 404 / сервер / сессия, экран профиля. Черновой hash-UI (`web/src/`, `web/test.html`) — не продукт, не расширяйте его.

## Что нужно установить заранее

1. **Git** — [git-scm.com](https://git-scm.com/downloads). После установки закройте и снова откройте терминал.
2. **Node.js 22.16 или новее** (подойдёт 22 LTS не ниже 22.16 или 24) — [nodejs.org](https://nodejs.org/). Отметьте установку npm, если установщик спрашивает.

Проверка:

```bash
git --version
node -v
npm -v
```

`node -v` должен показать `v22.16…` или `v24…`. Версии 18, 20 и 22.15 и старше **не подойдут**: база идёт через встроенный `node:sqlite`.

Windows: команды ниже работают в PowerShell. Если `npm` не находится — перезапустите терминал после установки Node.

## Запуск с нуля (локально)

Нужны **два терминала**: в одном API, в другом страницы. Не открывайте `web/index.html` двойным щелчком — запросы к API так не пойдут.

### 1. Скачать код

```bash
git clone https://github.com/khramov-nikita/nogotochki.git
cd nogotochki
```

Репозиторий закрытый: без доступа на GitHub `git clone` не сработает. Если папка проекта уже есть, этот шаг пропустите.

GitHub для HTTPS больше не принимает пароль аккаунта. Если clone спросит пароль — нужен Personal Access Token, `gh auth login` или SSH-ключ.

### 2. Файл настроек

В **корне** репозитория скопируйте `.env.example` в `.env`.

PowerShell:

```powershell
Copy-Item .env.example .env
```

macOS / Linux:

```bash
cp .env.example .env
```

Файл `.env` в git не коммитится. Для первого локального запуска менять значения не нужно: пароли тестовых учёток уже в примере. `NODE_ENV` оставьте пустым.

**Вход через Яндекс:** задайте `YANDEX_CLIENT_ID`, `YANDEX_CLIENT_SECRET` и `YANDEX_REDIRECT_URI` из кабинета на https://oauth.yandex.ru/. Redirect URI должен совпадать с зарегистрированным (на проде: `https://nogotochki-test.ru/auth/yandex/callback`). Токен Яндекса не хранится.

### 3. API и база (терминал 1)

```bash
cd server
npm install
npm run db:dev
npm start
```

Дождитесь:

```text
nogotochki api listening on http://127.0.0.1:3000
```

`db:dev` создаёт `data/nogotochki.sqlite`, накатывает миграции и заполняет услуги, мастеров и три учётки. Терминал не закрывайте.

Проверка: http://127.0.0.1:3000/api/health → `{"ok":true}`.

### 4. Клиентский интерфейс (терминал 2)

Из **корня** репозитория:

```bash
cd web
npm install
npm run dev
```

Обычно http://localhost:5173/ . Страницы открывайте **с этого адреса**, не с порта 3000. Vite проксирует `/api` на API; cookie-сессия идёт через тот же origin.

## Что открыть и чем войти

| Куда | Зачем |
|---|---|
| http://localhost:5173/ | Лендинг |
| http://localhost:5173/auth.html | Вход |
| http://localhost:5173/booking.html | Запись, шаг 1 |
| http://localhost:5173/cabinet.html | Кабинет (нужна сессия) |
| http://localhost:5173/admin (через API-хост после входа админом) | Админка |
| http://127.0.0.1:3000/api/health | Проверка, что API жив |
| https://nogotochki-test.ru | Опубликованный сервис |

После `npm run db:dev` (пароли совпадают с `.env.example`):

| Почта | Пароль | Роль |
|---|---|---|
| `client@nogotochki.test` | `DevClient123!` | клиент, кабинет |
| `master@nogotochki.test` | `DevMaster123!` | мастер (отдельного UI мастера нет) |
| `admin@nogotochki.test` | `DevAdmin123!` | администратор (`/admin`) |

На **production** эти seed-учётки могут отсутствовать. Первого админа на пустой БД задают через `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` в панели Coolify (см. `.env.example`).

Ошибки API, в том числе «Это время уже занято», показываются текстом на экране.

## Публикация (Coolify)

Сервис собирается из `Dockerfile` и поднимается по `docker-compose.yaml`:

- порт приложения внутри контейнера — `3000` (`expose`, без host bind);
- `NODE_ENV=production`, `TRUST_PROXY=1`;
- база на томе `nogotochki_data` → `/data/nogotochki.sqlite` (`DATABASE_PATH`);
- миграции применяются при старте процесса.

В Coolify задайте секреты окружения: `YANDEX_*`, при необходимости `BOOTSTRAP_ADMIN_*`. Автодеплой идёт с ветки `main`.

Подробности и разбор поломок публикации — в `docs/development-log.md` и `Отчет о публикации сервиса.md`.

## Если не запускается

| Что видите | Что сделать |
|---|---|
| `git clone` просит пароль / Permission denied | Нужен доступ к private-репозиторию; либо откройте уже скачанную папку |
| `node -v` ниже v22.16 или команда не найдена | Установите Node 22.16+ / 24 и откройте новый терминал |
| `npm install` в `server/` ругается на `engines` | Та же причина: слишком старая Node (`engine-strict`) |
| `DEV_ADMIN_PASSWORD must be set` | Нет `.env` в корне репозитория или файл лежит в `server/.env` |
| `seed:dev нельзя запускать при NODE_ENV=production` | В `.env` уберите `NODE_ENV=production`; на проде `seed:dev` не запускайте |
| Порт 3000 или 5173 занят | Закройте старый процесс или смените `PORT` в `.env` |
| Страница открылась, услуги пустые, вход не работает | API не запущен или не выполнен `npm run db:dev` |
| В DevTools `ECONNREFUSED` / `502` на `/api` | Запущен только Vite, нет `npm start` в `server/` |
| Открыли http://127.0.0.1:3000/ — не тот UI / только API | Локально интерфейс — порт **5173**; на проде UI и API на одном HTTPS-домене |
| После регистрации на HTTP-проде снова вход | Cookie с `Secure` не сохранится без HTTPS; на проде нужен https-домен (см. журнал) |
| Создание записи отвечает 500 | Локальная база старше кода. В `server/`: `npm run migrate`, затем `npm run seed:dev` |
| Windows: OneDrive блокирует файл `.sqlite` | Поставьте папку проекта вне синхронизации или сделайте паузу OneDrive |

Полностью пересобрать локальную базу (сотрёт записи): в `server/` выполните `npm run db:reset`, затем `npm run seed:dev`. На сервере с данными так делать нельзя.

## Что в папках

| Путь | Назначение |
|---|---|
| `server/` | Express API, порт 3000, `npm start` |
| `web/` | Продуктовый UI (клиент + админка), локально Vite на 5173 |
| `web/src/`, `web/test.html` | Старый hash-черновик, не продукт |
| `data/` | Файл SQLite локально, в git не входит |
| `Dockerfile`, `docker-compose.yaml` | Сборка и запуск на Coolify |
| `docs/ui-map.md` | Карта экранов ↔ API |
| `docs/frontend-rules.md` | Правила верстки |
| `docs/database.md` | Журнал бэкенда, команды БД, таблица маршрутов `/api` |
| `docs/db-schema.md` | Модель таблиц |
| `docs/development-log.md` | Журнал разработки, деплой, OAuth, фиксы |
| `docs/test-checklist.md` | Полный чек-лист сценариев |
| `docs/prod-checklist.md` | Сокращённый чек-лист после публикации |
| `docs/prod-check-results/` | Протоколы прогона на боевом адресе |
| `Паспорт сервиса «Ноготочки».md`, `Путь клиента.md` | Продукт и сценарии |
| `cloud.md` | Бриф для агентов |
| `Отчет о подключении экранов.md` | Отчёт: экраны ↔ API |
| `Отчет о тестировании сервиса.md` | Отчёт по сценариям тестирования |
| `Отчет о публикации сервиса.md` | Отчёт по боевому адресу, Яндексу, ПДн |
| `Дневник сборки сервиса записи «Ноготочки».xlsx` | Дневник шагов проектной работы |

Корневого `package.json` нет: `npm install` и `npm start` только из `server/` или `web/`.

## Другие команды (из `server/`)

```bash
npm run migrate    # только новые SQL-миграции
npm run seed       # витрина как в паспорте, без тестовых логинов
npm run seed:dev   # тестовые учётки (не для production)
npm run db:setup   # migrate + seed
npm run db:dev     # migrate + seed:dev — обычный локальный старт
npm run db:reset   # удалить локальный файл БД и накатить миграции
npm test           # расчёт окон и сценарии /api
```
