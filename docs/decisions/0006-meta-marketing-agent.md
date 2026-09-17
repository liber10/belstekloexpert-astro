# ADR-0006: full-cycle Meta marketing agent с изолированными principals

Статус: принят для поэтапной реализации; production publish не утверждён.

Дата: 15 августа 2026 года.

## Контекст

Проекту нужен агент полного цикла: аудит, создание рекламных кампаний, подготовка
и публикация Page/Instagram content, получение лидов и оптимизация по результатам.
Существующий Meta Ads-плагин реализует read-only анализ и ограниченные pause,
resume и budget writes. В отдельной implementation-ветке добавляется локальный v1:
он готовит и dry-run-ит один узко ограниченный website-leads bundle, а при
отдельной конфигурации может materialize его только в состоянии `PAUSED`. Он не
активирует кампании, не публикует креативы и не получает lead PII.

Meta System User является service identity, а не самим ИИ-агентом. Один системный
пользователь с полными правами создаёт единый blast radius: компрометация token или
ошибка workflow одновременно затронет расходы, публикации, лиды и business assets.

## Решение

Логически используется один Meta marketing agent, но credentials и execution
capabilities разделяются:

1. `observer` — только Insights и структура allow-listed ad account;
2. `ads-operator` — только ads management на конкретном account;
3. `content-publisher` — только Facebook Page и linked Instagram publishing;
4. `lead-ingest` — только webhook/retrieval выбранных Page/Form;
5. `conversion-uploader` — только утверждённый Dataset/CAPI.

Runtime principals получают роль Employee и asset-specific tasks. Им запрещены
Business Admin, billing, finance, roles, arbitrary audiences и generic Graph API.
Human break-glass admin с 2FA сохраняет управление активами.

Codex MCP остаётся operator UI и не хранит Meta secrets. Durable Meta Control Plane
владеет proposal/spec, policy, независимым human approval, idempotency, очередью,
reconciliation, audit и kill switches. Lead Hub остаётся единственным владельцем
PII, фото, статусов и attribution; агенту доступны только агрегаты качества.

## Процесс применения

```text
observe -> plan -> approve exact spec -> create PAUSED
        -> reconcile -> approve publish -> activate -> monitor -> learn
```

- approval code/secret не возвращается тому же агенту;
- каждый approval является detached Ed25519 signature, создаётся человеком вне
  MCP и связан с exact spec hash, policy version, account, режимами и expiry;
- новые campaign/ad set/ad создаются только `PAUSED`;
- publish имеет отдельное подтверждение и включает root campaign последней;
- каждый POST имеет idempotency ledger и read-after-write;
- unknown outcome устанавливает account-level lock и не повторяется без provider
  reconciliation;
- audit не содержит token, PII, photo URL или raw lead payload.

Локальный campaign-bundle v1 имеет ещё более узкую поверхность: одна allow-listed
campaign `OUTCOME_LEADS` с destination Website, один ad set и 1–3 ads. Page, Pixel,
media, broad location targeting template и landing host выбираются только по
логическим ключам из строгого внешнего catalog; произвольные provider IDs и
targeting не принимаются. Activation/publish/delete, upload media, Instant Forms и
изменение targeting этим контуром запрещены.

## Разрешённая автономия

Первый bounded autopilot может:

- emergency pause;
- уменьшить бюджет в owner-approved пределах;
- сформировать новый proposal или preview.

Он не может автоматически:

- resume или увеличить бюджет;
- менять targeting;
- создавать и публиковать новую кампанию;
- публиковать органический контент;
- удалять объекты;
- менять billing, roles или business assets.

Расширение автономии требует нового ADR, достаточного quality signal и отдельной
оценки рисков.

## Photo и content boundary

Lead photos остаются в private B2/Lead Hub и не доступны агенту. Использование
клиентского изображения в рекламе или публикации требует отдельного release,
деидентификации, удаления EXIF и копирования в content staging. Signed lead URL
нельзя передавать Meta как publishing media URL.

Для кампании ремонта сколов используется существующая website-form с private
upload. Instant Form без документированного respondent photo field и
click-to-message являются отдельными экспериментами.

## Поэтапный rollout

1. `observe`: текущий read-only account audit.
2. Identity: вручную создать scoped system users, назначить assets, включить token
   rotation/revoke и `appsecret_proof`; writes остаются off.
3. Data: подписанный Meta webhook в durable Lead Hub, structured outcomes и
   aggregate quality API.
4. Plan: persistent specs, previews, dry-run, immutable detached approvals,
   durable ledger, account lock и audit. Локальная v1-реализация этого этапа идёт
   в отдельной ветке и по умолчанию выключена.
5. Canary: создать PAUSED bundle на тестовом/неактивном объекте и сверить Ads
   Manager, preview и reconciliation.
6. Guarded launch: одна website campaign ремонта сколов с human approval, lifetime
   cap и kill switch; каждый organic post также утверждается отдельно.
7. Feedback: CAPI/CRM stages после legal review и проверенной дедупликации.
8. Bounded automation: только pause/reduce после достаточного объёма
   qualified/booked/won.

## Последствия

- настройка сложнее, чем один admin-token, но компрометация одного principal не
  даёт полный контроль;
- dedicated campaign-bundle ledger закрывает локальную idempotency и reconciliation
  для этого узкого сценария; in-memory store обычных change sets всё ещё
  недостаточен для always-on agent и должен быть заменён durable control plane;
- publish queue и webhook ingress должны работать независимо от локальной сессии
  Codex;
- права и API version проверяются capability probe: текущий плагин остаётся на
  Graph v25.0, переход на v26 выполняется отдельно с contract tests;
- ADR-0004 остаётся действующим для текущего локального control plane и не
  переписывается задним числом.
