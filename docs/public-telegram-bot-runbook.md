# Публичный Telegram-бот: развёртывание и эксплуатация

Публичный бот предназначен только для клиентов. Он не заменяет внутреннего бота
рабочей группы и должен иметь отдельные token, webhook secret и route.

## Создание через BotFather

1. В официальном `@BotFather` выполнить `/newbot`.
2. Имя: `BelStekloExpert — заявка`.
3. Username выбрать уникальный, оканчивающийся на `bot`.
4. Token сохранить только в Render environment; не отправлять в чат, Git или
   документацию.
5. Через `/setdescription` указать, что бот принимает заявку на автостекло и
   передаёт её менеджеру BelStekloExpert.
6. Через `/setcommands` пока задать только `start - Оставить заявку`.

## Граница включения

Route, PostgreSQL session state и отдельный outbox реализованы. До одобрения
`LEGAL-001` бот остаётся без рекламы и без production webhook. Внутренний bot token
нельзя использовать как public token.

Имена Render environment без значений:

```text
TELEGRAM_PUBLIC_ENABLED=false
TELEGRAM_PUBLIC_BOT_TOKEN=
TELEGRAM_PUBLIC_BOT_USERNAME=
TELEGRAM_PUBLIC_WEBHOOK_SECRET=
TELEGRAM_PUBLIC_PRIVACY_VERSION=
TELEGRAM_PUBLIC_SESSION_TTL_HOURS=24
```

`TELEGRAM_PUBLIC_BOT_TOKEN` и `TELEGRAM_PUBLIC_WEBHOOK_SECRET` создаются независимо
от внутреннего Telegram-бота и вводятся только напрямую в Render. Для rollback
достаточно установить `TELEGRAM_PUBLIC_ENABLED=false` и выполнить redeploy.

## Порядок безопасного включения

1. Развернуть код и миграцию с `TELEGRAM_PUBLIC_ENABLED=false`.
2. Одобрить текст согласия и версию privacy notice по `LEGAL-001`.
3. Ввести отдельные public-bot secrets в Render и указать username без `@`.
4. Установить одобренную версию в `TELEGRAM_PUBLIC_PRIVACY_VERSION`.
5. Переключить `TELEGRAM_PUBLIC_ENABLED=true` и дождаться успешного redeploy.
6. Выполнить smoke test ниже; только после него публиковать ссылку или QR.

## Реализованный MVP

`/start` с необязательным campaign code → услуга → короткий комментарий → телефон
через Telegram contact или ручной ввод → подтверждение согласия → Lead Hub →
внутренняя Telegram-карточка.

Session state хранится в PostgreSQL. Публичный бот не получает внутренние команды,
статусы и доступ к рабочей группе. Фото, Mini App, operator relay и Telegram
Business не входят в MVP.

## Smoke test перед рекламой

- `/start` без campaign code;
- `/start <test-code>` и сохранение attribution;
- один confirm создаёт один lead;
- повтор Telegram update не создаёт дубль;
- карточка приходит во внутреннюю группу;
- статус внутреннего бота обновляет существующий lead;
- rollback выполняется через `TELEGRAM_PUBLIC_ENABLED=false`.
