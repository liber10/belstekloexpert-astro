# Meta DM / lead-ingest runbook

Статус: локальный P0-срез реализован; production webhook и автоответ выключены.

## Что реализовано

Lead Hub принимает только при включённом `META_INGEST_ENABLED=true`:

1. `GET /api/v1/webhooks/meta` — подписка Meta с verify token;
2. `POST /api/v1/webhooks/meta` — проверка `X-Hub-Signature-256` по исходным
   JSON-байтам, allow-list получателя и дедупликация по `message.mid`;
3. нормализация входящего DM без сохранения provider attachment URL;
4. durable `integration_inbox` → retry/dead-letter через существующий worker;
5. первый message в диалоге фиксируется как `source=meta`, после чего используется
   существующий Lead Hub outbox для уведомления рабочего Telegram-чата;
6. безопасная диагностика события:
   `GET /api/v1/integrations/meta/events/<externalEventId>` с Bearer
   `WEB_INGEST_API_KEY`.

Таким образом, фиксация входящего Meta-сообщения не зависит от автоответа. Если
внешний Meta-бот не ответил, событие всё равно должно появиться в inbox/lead и
дать Telegram-задачу.

## Отдельный трек: «снова не срабатывает бот»

Скриншот показывает Instagram Direct и рекламный click-to-message сценарий. Это
не Telegram-бот и не форма сайта. На текущем этапе код принимает и фиксирует
входящий Meta message, но намеренно **не отправляет автоответ**: для этого нужен
отдельный Meta messaging principal, отдельный Graph permission и отдельный
human-approved rollout. `ads_management`/`ads_read` токен для ответов в Direct
не подходит.

Если событие не появляется в Lead Hub, причина находится до persistence:
подписка Meta, выбранный Page/Instagram asset, allow-list ID, verify token,
app-secret signature или webhook delivery. Если событие есть со статусом `dead`,
проблема находится в нормализации/worker. Если событие `done`, но клиент не
получил ответ, это отдельный outbound messaging контур, а не потеря лида.

## Переменные окружения (секреты вне Git)

```text
META_INGEST_ENABLED=false
META_WEBHOOK_VERIFY_TOKEN=<random webhook verify token>
META_APP_SECRET=<Meta app secret>
META_ALLOWED_RECIPIENT_IDS=<Page/Instagram recipient IDs, comma separated>
```

Для production `META_ALLOWED_RECIPIENT_IDS` обязателен. Значения не добавляются
в `.env.example`, Markdown, логи или чат.

## Безопасная проверка

1. Включить route только на staging/test Lead Hub.
2. Настроить Meta webhook на тестовый Page/Instagram asset.
3. Отправить тестовое сообщение и сверить HTTP 202.
4. По `message.mid` проверить trace endpoint.
5. Проверить, что один и тот же webhook повторно возвращает `deduplicated=true`.
6. Убедиться, что в Telegram появился только outbox-card, без Meta reply.
7. Перед production отдельно согласовать messaging principal, copy, rate limits,
   opt-out и автоответы. Live сообщения клиентам этим изменением не выполняются.
