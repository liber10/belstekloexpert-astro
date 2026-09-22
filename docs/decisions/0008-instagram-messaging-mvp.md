# ADR-0008: первый Instagram-ответ через существующий Lead Hub

Дата: 22 сентября 2026 года. Статус: реализован локально, production не утверждён.

## Контекст и границы

Текущий токен/аккаунт используют Instagram Login. Meta ingress, PostgreSQL inbox,
лиды, lead_events и integration_outbox уже существуют. В старом обработчике
разные DM одного диалога конфликтовали по request hash; outbound отсутствовал.
Telegram worker не фильтровал destination и не был готов к соседнему отправителю.

Задача ограничена Instagram DM → durable persistence → первый ответ → audit /
retry / dead-letter / рабочий Telegram alert. Ads, publishing, Performance Agent,
новые ingress, каналы, хранилища и миграции не добавляются.

## Решение

1. Сохраняем единый подписанный Meta webhook. Отбрасываем echo/self/deletion и
   Instagram-события без настоящего mid. Идемпотентность inbox остаётся по mid.
2. Instagram-specific метод LeadService допускает изменение текста внутри
   сохранённого диалога. Строгая идемпотентность форм сайта не ослабляется.
3. Существующий LeadService фиксирует лид и Telegram-card job. Следующая
   транзакция с блокировкой строки лида фиксирует отдельный DM, единственное
   first-reply decision и Instagram job. Durable inbox закрывает окно между
   транзакциями при crash; Instagram вызывается только после их commit.
4. `instagram:first:<lead UUID>` — одно задание на диалог. Uniqueness событий и
   row lock предотвращают дубли от разных workers. Другой DM не перезаписывает
   первое сообщение; первый decision принадлежит DM, создавшему лид.
5. Отдельный adapter использует Instagram user token и фиксированный
   graph.instagram.com/version/account/messages. У него нет Ads operations,
   произвольного URL и неявных сетевых retries. Scopes: basic/manage_messages.
6. Перед сетью job становится sending. Результат фиксируется условно по
   job ID/status/attempt; поздний worker не отменяет dead-letter. Known retryable
   rejection получает backoff, permanent → dead, unknown → dead с ручной сверкой.
   Dead и постановка Telegram alert атомарны. Telegram выбирает только своё
   destination и обрабатывает alert штатным retry/dead-letter.
7. Отправитель выключен по умолчанию, требует явных approved texts и startAt.
   Старые диалоги/backlog не получают внезапный auto-reply. Окно исходного DM
   ограничено 24 часами минус запас 60 секунд, retry его не продлевает.
8. Сценарий берётся только из сопоставления известного ad ID, пришедшего в DM.
   Если контекста недостаточно — общий ответ, без Ads lookups/догадок.
9. Автоответ не меняет человеческий статус/firstResponseAt. DM и lead находятся
   в PostgreSQL; Telegram delivery может упасть независимо.

## Trade-offs

Provider idempotency для этой отправки не используется: end-to-end exactly-once
не обещается. Unknown outcome не повторяем, даже если это означает пропущенный
автоответ; alert требует человека. Telegram alert сам имеет at-least-once
delivery: при его собственном неизвестном исходе возможен повтор уведомления,
но не повтор DM клиенту. При outage обоих провайдеров остаются БД и диагностика.

Первый ответ — один на сохранённый диалог, не на каждые сутки. Старые диалоги
остаются ручными. Фото доступны человеку в Direct; media download не входит в MVP.
Free/sleeping Render не гарантирует постоянную работу polling: проверка тарифа и
наблюдение за worker являются gate production rollout.

## Проверки и эксплуатация

Unit tests проверяют fixed-host API, ошибки, timeout, конфигурацию и normalization.
Integration tests на отдельной PostgreSQL проверяют replay/concurrency, сохранение
истории, transactional rollback, crash-after-send, late result и escalation.
Реальные Meta/Telegram send не выполнялись. Production разрешается только после
отдельных approvals на deploy/settings/copy и end-to-end smoke.

Подробные env/settings, diagnostics, rollout и rollback находятся в
[runbook](../meta-messaging-runbook.md). Предпочтительный rollback — outbound off
на новой сборке при включённом ingress; старый Telegram worker не должен получить
Instagram pending/retry jobs. Данные не удаляются.
