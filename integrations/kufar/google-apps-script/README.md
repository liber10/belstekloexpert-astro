# Kufar Gmail adapter

Google Apps Script `BelStekloExpert — Kufar to Telegram` остаётся владельцем Gmail
polling и time-based trigger `processKufarMail`. Эта версия не отправляет сообщения
напрямую в Telegram: после парсинга она передаёт событие в durable inbox Lead Hub.

Script Properties, значения задаются только в Apps Script и не коммитятся:

- `LEAD_HUB_KUFAR_INGEST_URL` — полный HTTPS URL `/api/v1/integrations/kufar/email`;
- `KUFAR_INGEST_API_KEY` — отдельный bearer secret, совпадающий с Render environment;
- `KUFAR_SEEN_IDS` — управляется скриптом;
- `KUFAR_LAST_TS` — управляется скриптом.

После замены кода сначала запустить `initializeKufar` вручную, затем выполнить один
обезличенный smoke test. Письмо считается обработанным только после ответа Lead Hub
`200` или `202` с `accepted: true`. Старые `TELEGRAM_BOT_TOKEN` и
`TELEGRAM_CHAT_ID` этому adapter больше не нужны.
