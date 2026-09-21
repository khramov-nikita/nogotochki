# Итог проверки prod-checklist

## Базы

- Основная: `https://nogotochki-test.ru`
- Дополнительная / fallback: `http://159.194.227.249:3000` (G9, G12, G13; HTTPS на `:3000` недоступен)

## Дата

2026-09-21

## Сводка по сценариям

| ID | Статус | Кратко |
|---|---|---|
| G8 | pass | Empty на 2026-09-21: «Нет свободного времени», «Далее» disabled |
| G9 | pass | Слот 10:00, таймер резерва, `POST /api/holds` 201 |
| G12 | pass | После `expires_at`: «Резерв истек…», Confirm disabled / редирект на шаг 3 |
| G13 | pass | `auth.html?next=cabinet.html`, чужих записей нет |
| C1 | pass | Регистрация → кабинет empty + Secure `session` |
| C5 | pass | Seed `client@…` нет; login свежей учёткой → кабинет |
| C10 | pass | Согласие → кабинет + Secure session; отмена/ошибка → alert без сессии |
| C11 | pass | Шаги 1–4 → «Готово»; admin confirm предоплаты ещё blocked (нет админа) |
| C12 | pass | Guest hold → mid-flow register → тот же слот/услуга, Confirm enabled |
| C16 | pass | Перенос без `#hold-timer`; «Запись перенесена», «В кабинет» |
| C17 | pass | Empty на 2026-09-21; «Подтвердить перенос» disabled |
| A3 | blocked | Seed `admin@…` → 401; `/admin` → auth |
| A14 | blocked | Seed admin 401; time-block не создать |
| A15 | blocked | Seed admin 401; empty дня в `/admin` не проверен |
| S2 | pass | Второй hold → 409 `SLOT_TAKEN` «Это время уже занято» |
| S3 | pass | Confirm A → UI «Это время уже занято», без Done |
| S4 | pass | Logout закрывает кабинет; admin-половина blocked (seed 401) |
| S6 | pass | 10×401, затем 429 `RATE_LIMITED` («Слишком много попыток…») |

## Счётчики

| Статус | Кол-во |
|---|---|
| pass | 15 |
| fail | 0 |
| blocked | 3 |

Всего сценариев в prod-checklist: **18**.

## Блокеры (остались)

1. **Нет администратора на проде** (`admin@nogotochki.test` → 401): блокирует A3, A14, A15; частично — admin confirm в C11 и admin-выход в S4.
2. Как завести админа и допройти сценарии — раздел **«Как допройти невыполненные сценарии»** в [`docs/prod-checklist.md`](../prod-checklist.md).

## Детали

Полные протоколы — в `docs/prod-check-results/<ID>.md`. Колонка «Результат» в [`docs/prod-checklist.md`](../prod-checklist.md) заполнена для всех строк.
