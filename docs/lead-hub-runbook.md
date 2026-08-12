# Lead Hub: запуск и эксплуатация

Актуализировано: 12 августа 2026 года.

## Текущий объём

`apps/lead-hub` — отдельный сервис на Fastify/TypeScript с PostgreSQL. Он принимает лиды сайта, сохраняет лид и события, ставит доставку в Telegram в outbox и обрабатывает статусы из inline-кнопок.

Формы Astro-сайта подключены к Lead Hub через server-side endpoint Cloudflare
Worker `/api/lead/`. Секрет ingest API не попадает в браузер. Production Worker
работает в режиме `LEAD_DELIVERY_MODE=hub`, а Telegram webhook и outbox worker
выполняются Lead Hub на Render.

Фотографии сжимаются в браузере и напрямую загружаются в закрытый Backblaze B2 по короткоживущему signed URL. Lead Hub хранит только приватные `photo_refs` и создаёт временные download URL для отправки фото в Telegram.

## Поток данных

```text
POST /api/v1/leads/web
  -> validation / auth / rate limit / idempotency
  -> PostgreSQL: leads + lead_events + integration_outbox
  -> success response to the site
  -> Lead Hub outbox worker -> Telegram card and photos
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
| `OUTBOX_PROCESSING_TIMEOUT_MS` | Срок до возврата зависшей `processing`-задачи в `retry`; по умолчанию 300000 мс |
| `LOG_LEVEL` | Уровень структурированных логов |
| `OBJECT_STORAGE_ENDPOINT` | S3-compatible endpoint приватного хранилища |
| `OBJECT_STORAGE_REGION` | Регион S3-compatible API |
| `OBJECT_STORAGE_BUCKET` | Имя закрытого bucket |
| `OBJECT_STORAGE_ACCESS_KEY_ID` | Bucket-scoped access key |
| `OBJECT_STORAGE_SECRET_ACCESS_KEY` | Bucket-scoped secret key |
| `OBJECT_STORAGE_PREFIX` | Префикс объектов, по умолчанию `leads/` |
| `OBJECT_STORAGE_UPLOAD_TTL_SECONDS` | Срок действия signed PUT, по умолчанию 900 секунд |
| `OBJECT_STORAGE_DOWNLOAD_TTL_SECONDS` | Срок действия signed GET, по умолчанию 900 секунд |

В Git и документацию добавляются только имена переменных. Значения хранятся в
environment settings платформы.

Для server-side API production Worker используются:

| Переменная | Назначение |
| --- | --- |
| `WEB_INGEST_API_KEY` | Тот же bearer-ключ, что установлен в Lead Hub |
| `LEAD_HUB_URL` | Публичный URL Lead Hub; по умолчанию используется текущий Render-сервис |
| `LEAD_HUB_TIMEOUT_MS` | Таймаут server-to-server запроса от 5 до 30 секунд |
| `LEAD_DELIVERY_MODE` | `legacy`, `hub` или `hub-with-legacy-telegram` |
| `TELEGRAM_BOT_TOKEN` | Не используется при `hub`; временно может храниться только для rollback |
| `TELEGRAM_CHAT_ID` | Не используется при `hub`; временно может храниться только для rollback |

В production режим должен быть задан явно как `hub`. Если `LEAD_DELIVERY_MODE` не задан, функция выбирает безопасный режим автоматически: без ingest-ключа остаётся `legacy`; с ingest-ключом и Telegram-настройками используется `hub-with-legacy-telegram`; только с ingest-ключом — `hub`.

## Подключение форм сайта

- Все формы отправляются на совместимый URL `/api/lead/`.
- Один `submission_id` создаётся в браузере и проходит до PostgreSQL как `Idempotency-Key`.
- Повтор с тем же телом возвращает существующий публичный номер заявки.
- Сохраняются UTM, `gclid`, `gbraid`, `wbraid`, `yclid`, `fbclid`, первая посадочная страница и referrer.
- Режим `hub-with-legacy-telegram` сохранён только для контролируемого rollback. В нём Lead Hub атомарно выдаёт право на одну Telegram-отправку.
- Фото сжимаются в браузере, загружаются через signed PUT и передаются в заявке как `photo_refs`.
- Bucket остаётся закрытым; CORS разрешает только согласованные origins сайта.

Нельзя одновременно включать outbox worker Render и оставлять production Worker в
режиме `hub-with-legacy-telegram`: сначала нужно переключить Worker на `hub`, затем
включать `TELEGRAM_ENABLED=true` в Lead Hub.

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

Публичный endpoint Astro-сайта `/api/health/` делегирует проверку готовности
`/health/ready` Lead Hub. Он не подключается к PostgreSQL напрямую и возвращает
только обобщённый статус без URL, имени сервера или деталей ошибки.

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

Значения токена, chat ID и webhook secret задаются вне Git. При старте с `TELEGRAM_ENABLED=true` Lead Hub сначала регистрирует webhook через Telegram Bot API и только после успешной регистрации запускает outbox worker.

Webhook должен вести на:

```text
https://<lead-hub-host>/api/v1/webhooks/telegram
```

Ручная настройка через официальный Telegram Bot API используется только для диагностики или восстановления:

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

У одного бота не должно быть другого активного webhook или polling-процесса.

Поддерживаемые команды:

- `/new <телефон> <имя или комментарий>` — ручной лид;
- `/today` — лиды за текущий день;
- `/sla` — новые лиды без первого контакта;
- `/funnel` — текущая воронка.

Кнопки карточки меняют статусы `new`, `contacted`, `qualified`, `quote_sent`, `booked`, `arrived`, `won`, `lost`, `spam`, `duplicate`. Повторный callback не создаёт повторное событие.

## Kufar Gmail adapter

Интеграция включается только после успешного деплоя миграции и проверки
`/health/ready`. В Render задаются без публикации значений:

```text
KUFAR_INGEST_ENABLED=true
KUFAR_INGEST_API_KEY=<separate-random-secret>
```

В Google Apps Script с time-based trigger `processKufarMail` задаются Script
Properties:

```text
LEAD_HUB_KUFAR_INGEST_URL=https://<lead-hub-host>/api/v1/integrations/kufar/email
KUFAR_INGEST_API_KEY=<same-secret-as-render>
```

Актуальный адаптер находится в `integrations/kufar/google-apps-script/Code.gs`.
Он отмечает Gmail message ID обработанным только после durable acceptance Lead Hub
(`200` или `202` и `accepted: true`). Для rollback нужно вернуть предыдущий код
Apps Script либо установить `KUFAR_INGEST_ENABLED=false`; прямую и новую доставку
нельзя оставлять включёнными одновременно.

## Outbox и ошибки

Telegram отправляется асинхронно из `integration_outbox`. При ошибке задача получает следующую попытку с задержкой. После `OUTBOX_MAX_ATTEMPTS` она переходит в `dead` и требует разбора причины и ручного повторного запуска после устранения сбоя. Задача, оставшаяся в `processing` дольше `OUTBOX_PROCESSING_TIMEOUT_MS`, автоматически возвращается в `retry`.

Логи структурированы. Полный телефон, VIN, bot token, API key и webhook secret логировать запрещено.

Render Free Web Service может переходить в сон. После холодного запуска первая
заявка может ждать дольше обычного, поэтому нужно контролировать время ответа
`/health/ready`, ошибки формы и накопление `pending`, `retry` и `dead` в outbox.
Frontend один раз повторяет временно неуспешную подготовку фото или передачу лида.
Повтор использует тот же `submissionId` и `Idempotency-Key`, поэтому не должен
создавать второй лид.

## Rollback Telegram

Откат выполняется только в таком порядке:

1. установить `TELEGRAM_ENABLED=false` на Render и дождаться успешного деплоя;
2. убедиться, что worker остановлен и новый webhook больше не обрабатывает команды;
3. установить `LEAD_DELIVERY_MODE=hub-with-legacy-telegram` в конфигурации
   production Worker;
4. пересобрать и опубликовать `belstekloexpert-production`;
5. отправить одну явно тестовую заявку и проверить единственную карточку Telegram.

Нельзя сначала включать переходный мост Cloudflare Worker: одновременная работа двух
доставщиков создаёт риск повторных уведомлений.

## Проверки разработчика

```powershell
npm run lead-hub:check
npm run test:site
npm run build:cloudflare:production
npm run deploy:cloudflare:production:dry
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
- Bucket object storage закрыт, а ключ ограничен нужным bucket и операциями.
- Сервис доступен только по HTTPS.
- `/health/ready` возвращает `200`.
- Тестовый запрос создаёт ровно один лид при повторной отправке.
- Большое фото проходит сжатие, signed PUT, сохранение `photo_ref` и Telegram delivery.
- Карточка появляется в тестовом Telegram-чате.
- Кнопка статуса обновляет карточку и создаёт одно событие.
- Проверены `/today`, `/sla`, `/funnel` и ручной `/new`.
- Проверены retry и мониторинг задач `dead`.
- Production webhook зарегистрирован Lead Hub на Render.

## Оставшиеся этапы

Формы, калькулятор, идемпотентность, web attribution, приватное object storage, Telegram webhook и outbox worker подключены к production-контуру Lead Hub.

Frontend уже работает на Cloudflare Workers. Следующий независимый
инфраструктурный этап — оценка миграции B2 в R2 без изменения контракта
`photo_refs`. Параллельно нужно добавить мониторинг `dead`-задач и утвердить сроки
хранения данных. Meta, рекламные конверсии и телефония остаются последующими
этапами.
