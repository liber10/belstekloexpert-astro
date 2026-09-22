# ADR-0007: отдельная read-only граница Instagram Graph

Статус: принят для локального/staging этапа; production outbound не утверждён.

Дата: 21 сентября 2026 года.

Дополнение 22 сентября: read-only клиент теперь также читает `user_id` для
сверки Instagram Login account. Отдельный локальный messaging adapter и durable
outbox описаны в [ADR-0008](0008-instagram-messaging-mvp.md); этот ADR не является
разрешением на production отправки. Publishing по-прежнему вне реализации.

## Контекст

Instagram User Access Token, полученный через Instagram API with Instagram Login,
отличается от Marketing API-токенов Meta Ads. Он принимается Instagram Graph host
`graph.instagram.com` и не должен передаваться в `META_READ_ACCESS_TOKEN` или
`META_WRITE_ACCESS_TOKEN`.

Существующий Lead Hub уже принимает подписанный Meta webhook, но inbound ingest,
Telegram outbox и сохранение лида не требуют Instagram access token. Автоответы,
публикация и изменение контента намеренно не включены.

## Решение

1. В Lead Hub добавляется отдельная необязательная переменная
   `META_INSTAGRAM_ACCESS_TOKEN`.
2. Read-only клиент использует только фиксированный `https://graph.instagram.com`
   и endpoint `/me?fields=id,username`.
3. Локальная команда `instagram:check` выводит только факт успеха и наличие
   безопасных полей; token, ID и username не выводятся.
4. Ads MCP не получает Instagram-токен через свой allowlist окружения.
5. Inbound webhook остаётся независимым от этого токена. Outbound messaging,
   content publishing и insights требуют отдельного implementation, permissions,
   review и human-approved rollout.

## Безопасность

- Значение токена хранится только во внешнем окружении и памяти процесса.
- Ошибки Graph API очищаются от настроенного токена.
- В Git, Markdown, логи и чат не попадают значения токенов или signed URL.
- Production secrets пока не добавляются и не меняются.

## Проверка

```powershell
npm run instagram:check --workspace @belstekloexpert/lead-hub
```

Команда выполняет один read-only GET-запрос. Для production она не включается
автоматически и не отправляет сообщения клиентам.

## Что потребуется для следующего этапа

Для тестового webhook понадобятся `META_WEBHOOK_VERIFY_TOKEN` и точный
`META_ALLOWED_RECIPIENT_IDS`. Для production auto-reply/publishing потребуются
проверенные Meta permissions, опубликованное приложение или разрешённый тестовый
principal, callback URL, copy/opt-out policy и отдельное human approval.
