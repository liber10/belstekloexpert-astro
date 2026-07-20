# Lead Hub: запуск и эксплуатация

## Текущий объём

`apps/lead-hub` — отдельный сервис на Fastify/TypeScript с PostgreSQL. Он принимает лиды сайта, сохраняет лид и события, ставит доставку в Telegram в outbox и обрабатывает статусы из inline-кнопок.

В этой версии реализован только CODEX-1. Формы Astro-сайта ещё не переключены на новый API, production webhook Telegram не менялся, DNS и Netlify не затрагивались.

## Поток данных

```text
POST /api/v1/leads/web
  -> validation / auth / rate limit / idempotency
  -> PostgreSQL: leads + lead_events + integration_outbox
  -> outbox worker
  -> Telegram card
  -> status callback
  -> lead status + lead_event + Telegram card update
```

## Переменные окружения

Все секреты задаются только через окружение или секреты платформы. Их нельзя добавлять в Git, логи или документацию.

| Переменная | Назначение |
| --- | --- |
| `DATABASE_URL` | PostgreSQL URL для сервиса и миграций |
| `TEST_DATABASE_URL` | Отдельная PostgreSQL БД для integration tests |
| `WEB_INGEST_API_KEY` | Bearer-ключ для приёма форм сайта; обязателен в production |
| `TELEGRAM_ENABLED` | `true` включает Telegram adapter и worker-доставку |
| `TELEGRAM_BOT_TOKEN` | Токен существующего или тестового бота |
| `TELEGRAM_CHAT_ID` | Разрешённый рабочий или тестовый чат |
| `TELEGRAM_WEBHOOK_SECRET` | Случайный секрет заголовка Telegram webhook |
| `LEAD_HUB_PUBLIC_URL` | Публичный HTTPS URL сервиса без завершающего `/` |
| `LEAD_HUB_ALLOWED_ORIGINS` | Разрешённые origins через запятую |
| `LEAD_HUB_RATE_LIMIT_MAX` | Максимум запросов за минуту на ingest endpoint |
| `OUTBOX_POLL_INTERVAL_MS` | Пауза между циклами worker |
| `OUTBOX_BATCH_SIZE` | Число задач, забираемых за один цикл |
| `OUTBOX_MAX_ATTEMPTS` | Число попыток до состояния `dead` |
| `LOG_LEVEL` | Уровень структурированных логов |

Полный безопасный шаблон находится в `.env.example`.

## Локальный запуск

Требуются Docker Desktop и Node.js 22+.

```powershell
docker compose -f apps/lead-hub/docker-compose.yml up -d --build
docker compose -f apps/lead-hub/docker-compose.yml ps
```

Проверка:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health/live
Invoke-RestMethod http://127.0.0.1:8787/health/ready
```

Остановка без удаления данных PostgreSQL:

```powershell
docker compose -f apps/lead-hub/docker-compose.yml down
```

Команда `down -v` удалит локальную БД и должна использоваться только для намеренного полного сброса тестовых данных.

## Миграции

Первая миграция: `apps/lead-hub/drizzle/0000_slim_mojo.sql`.

```powershell
$env:DATABASE_URL='postgres://lead_hub:lead_hub@localhost:54329/lead_hub'
npm run db:migrate --workspace @belstekloexpert/lead-hub
```

Перед production-миграцией нужно сделать резервную копию БД. Откат этой версии выполняется восстановлением backup или отдельной forward-migration; автоматически удалять таблицы нельзя.

## Проверка ingest API

Пример не содержит реальных персональных данных:

```powershell
$headers = @{
  Authorization = 'Bearer replace-with-local-key'
  'Idempotency-Key' = 'smoke-local-001'
}
$body = @{
  sourceDetail = 'calculator'
  phone = '+375291111111'
  name = 'Тестовый клиент'
  carMake = 'Volkswagen'
  carModel = 'Passat'
  landingUrl = 'http://localhost:4321/kalkulyator/'
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8787/api/v1/leads/web `
  -Headers $headers `
  -ContentType 'application/json' `
  -Body $body
```

Повтор с тем же `Idempotency-Key` и тем же телом возвращает исходный лид с `deduplicated: true`. Другое тело с тем же ключом возвращает `409`.

## Telegram

Для первого прогона использовать отдельный тестовый чат. Значения токена, chat ID и webhook secret задаются вне Git.

Webhook должен вести на:

```text
https://<lead-hub-host>/api/v1/webhooks/telegram
```

Настройка через официальный Telegram Bot API:

```powershell
$token = '<TELEGRAM_BOT_TOKEN>'
$secret = '<TELEGRAM_WEBHOOK_SECRET>'
$url = 'https://<lead-hub-host>/api/v1/webhooks/telegram'

Invoke-RestMethod `
  -Method Post `
  -Uri "https://api.telegram.org/bot$token/setWebhook" `
  -ContentType 'application/json' `
  -Body (@{ url = $url; secret_token = $secret } | ConvertTo-Json)
```

До переключения существующего бота проверить, что у него нет другого активного webhook или polling-процесса. В production переключать webhook только после согласования окна перехода.

Поддерживаемые команды:

- `/new <телефон> <имя или комментарий>` — ручной лид;
- `/today` — лиды за текущий день;
- `/sla` — новые лиды без первого контакта;
- `/funnel` — текущая воронка.

Кнопки карточки меняют статусы `new`, `contacted`, `qualified`, `quote_sent`, `booked`, `arrived`, `won`, `lost`, `spam`, `duplicate`. Повторный callback не создаёт повторное событие.

## Outbox и ошибки

Telegram отправляется асинхронно из `integration_outbox`. При ошибке задача получает следующую попытку с задержкой. После `OUTBOX_MAX_ATTEMPTS` она переходит в `dead` и требует разбора причины и ручного повторного запуска после устранения сбоя.

Логи структурированы. Полный телефон, VIN, bot token, API key и webhook secret логировать запрещено.

## Проверки разработчика

```powershell
npm run lead-hub:check
npm run build
```

Integration tests используют отдельную БД:

```powershell
$env:TEST_DATABASE_URL='postgres://lead_hub:lead_hub@localhost:54329/lead_hub'
npm run test:integration --workspace @belstekloexpert/lead-hub
```

Тесты очищают таблицы этой БД. Не указывать production database в `TEST_DATABASE_URL`.

## Production checklist

- Подготовлен управляемый PostgreSQL и сделан backup перед миграцией.
- Сгенерированы сильные `WEB_INGEST_API_KEY` и `TELEGRAM_WEBHOOK_SECRET`.
- Секреты добавлены в хранилище платформы, не в `.env` репозитория.
- CORS ограничен доменами сайта.
- Сервис доступен только по HTTPS.
- `/health/ready` возвращает `200`.
- Тестовый запрос создаёт ровно один лид при повторной отправке.
- Карточка появляется в тестовом Telegram-чате.
- Кнопка статуса обновляет карточку и создаёт одно событие.
- Проверены `/today`, `/sla`, `/funnel` и ручной `/new`.
- Проверены retry и мониторинг задач `dead`.
- Только после этого согласовано переключение production webhook.

## Оставшиеся этапы

CODEX-2 подключит формы и калькулятор Astro-сайта к этому API, добавит атрибуцию UTM/click IDs и безопасную загрузку фото. Meta, рекламные конверсии, телефония и почтовые адаптеры Kufar/Onliner остаются отдельными последующими этапами.
