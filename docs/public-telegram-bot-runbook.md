# Публичный Telegram-бот: подготовка владельца

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

До реализации route и одобрения `LEGAL-001` бот остаётся без рекламы и без
production webhook. Внутренний bot token нельзя использовать как public token.

Планируемые имена Render environment без значений:

```text
TELEGRAM_PUBLIC_ENABLED=false
TELEGRAM_PUBLIC_BOT_TOKEN=
TELEGRAM_PUBLIC_BOT_USERNAME=
TELEGRAM_PUBLIC_WEBHOOK_SECRET=
TELEGRAM_PUBLIC_PRIVACY_VERSION=
```

## Планируемый MVP

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

