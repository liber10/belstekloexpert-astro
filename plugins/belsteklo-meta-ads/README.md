# BelSteklo Meta Ads

Локальный Codex-плагин для анализа Meta Ads и ограниченного управления рекламой
BelStekloExpert. Production-кабинет не подключается автоматически: токены и
разрешённые рекламные аккаунты задаются только вне Git.

## Модель безопасности

- Graph host фиксирован на `graph.facebook.com`, версия API обязательна и валидируется.
- Рекламный аккаунт должен входить в серверный allowlist.
- Для чтения и записи используются разные токены.
- В ответах используются временные `entity_ref`; исходные Meta IDs не возвращаются.
- Изменение проходит `prepare -> diff -> apply` и имеет короткий TTL.
- Перед apply повторно читается текущее состояние; устаревший change-set отклоняется.
- Бюджет ограничен абсолютным потолком и максимальным процентом изменения.
- Все prepare/apply/reject события пишутся в локальный JSONL-аудит без токенов и PII.
- Для создания используется отдельный, по умолчанию выключенный campaign-bundle
  контур с собственным режимом, durable ledger и account-level lock.
- Bundle связывается с точным hash плана и detached Ed25519 approval, который
  создаётся человеком вне MCP и не возвращается агенту.
- Удаление, activation/publish, billing, роли, audiences, произвольный targeting,
  upload медиа и Instant Forms не реализованы.

## Режимы записи

| `META_WRITE_MODE` | Поведение |
| --- | --- |
| `off` | Значение по умолчанию. Только чтение и подготовка плана. |
| `dry-run` | Apply фиксируется как симуляция, Meta не изменяется. |
| `guarded` | Разрешён apply одобренного change-set в пределах policy. |
| `autopilot` | Разрешены только pause и уменьшение бюджета; запускать после отдельного operational review. |

Создание объектов не включается ни одним из этих режимов автоматически. Для него
действует отдельный `META_CAMPAIGN_BUNDLE_MODE`:

| `META_CAMPAIGN_BUNDLE_MODE` | Поведение |
| --- | --- |
| `off` | Значение по умолчанию. Bundle creation отключён. |
| `dry-run` | Проверяется exact plan и записывается локальная симуляция; Graph POST не выполняется. |
| `guarded` | Допускает materialize только при всех дополнительных guardrails ниже. |

В локальном v1 поддерживается только один allow-listed website-leads bundle:
campaign `OUTCOME_LEADS`, один ad set и 1–3 объявления. Campaign, ad set и ads
создаются только `PAUSED`. Этот шаг не активирует и не публикует их. Policy v1
также отклоняет аккаунт, если его currency/timezone отличаются от ожидаемых
`USD` / `Europe/Minsk`.

## Локальная установка

```powershell
npm install
npm run check
```

Перезапустите Codex после установки плагина. Никогда не вставляйте access token в
чат, Markdown, Git или команду, которая попадёт в историю терминала.

## Переменные окружения

Обязательны для чтения:

- `META_READ_ACCESS_TOKEN`;
- `META_AD_ACCOUNT_ID`;
- `META_ALLOWED_AD_ACCOUNT_IDS` — список разрешённых аккаунтов через запятую.

Для guarded write дополнительно:

- `META_WRITE_ACCESS_TOKEN`;
- `META_APP_SECRET` — обязателен: write-token запросы без `appsecret_proof`
  отклоняются до обращения к Meta;
- `META_WRITE_MODE=guarded`;
- `META_MAX_DAILY_BUDGET_MINOR` — абсолютный потолок в minor currency units.

Для campaign-bundle v1 используются отдельные переменные:

- `META_CAMPAIGN_BUNDLE_MODE=off|dry-run|guarded`, по умолчанию `off`;
- `META_BUNDLE_CREATION_ENABLED=true` — дополнительный kill switch; сам по себе
  ничего не включает;
- `META_MAX_BUNDLE_LIFETIME_BUDGET_MINOR` — абсолютный lifetime cap в minor units;
- `META_BUNDLE_PROPOSAL_TTL_MINUTES` — TTL подготовленного exact plan;
- `META_BUNDLE_STATE_DIR` — абсолютный каталог durable ledger и account locks;
- `META_BUNDLE_ASSET_CATALOG_PATH` — абсолютный путь к строгому внешнему JSON
  catalog разрешённых Page, Pixel, media, targeting templates и evidence-backed
  price claims;
- `META_BUNDLE_APPROVALS_PATH` — абсолютный каталог detached approval-файлов,
  который заполняется вне MCP;
- `META_BUNDLE_APPROVAL_PUBLIC_KEY_B64` — только публичный Ed25519-ключ проверки;
- `META_BUNDLE_POLICY_VERSION` — версия policy, включаемая в approval;
- `META_ALLOWED_LANDING_HOSTS` — точный список разрешённых HTTPS-host через запятую.

Для реального materialize одновременно нужны `META_WRITE_MODE=guarded`,
`META_CAMPAIGN_BUNDLE_MODE=guarded`, `META_BUNDLE_CREATION_ENABLED=true`, lifetime
cap, абсолютные paths, валидный catalog и действующий detached approval. Приватный
ключ подписанта не должен находиться в MCP, окружении плагина или чате.

Draft canary ремонта сколов сохранён в
`examples/chip-repair-bundle.request.json`: `$35` lifetime на семь полных дней,
один широкий ad set Минска и три статичных варианта. Один вариант использует
catalog claim `от 30 BYN`; без точного действующего claim произвольная цена
отклоняется. Price claim дополнительно требует отдельный
`offer_approval_ref`, точную оговорку об оценке после фото/осмотра и срок действия,
покрывающий весь период кампании. `examples/campaign-bundle-catalog.template.json` намеренно содержит
невалидные `REPLACE_*` значения и не может быть использован напрямую: Page,
Dataset/Pixel, три Meta image hash и business-offer approval должны быть проверены
владельцем и записаны во внешний файл вне Git. Центр 20-km шаблона уже совпадает с
публичными координатами мастерской из `public/llms.txt`.

Опционально:

- `META_GRAPH_VERSION`, по умолчанию `v25.0`;
- `META_MAX_BUDGET_CHANGE_PCT`, по умолчанию `20`;
- `META_CHANGE_TTL_MINUTES`, по умолчанию `15`;
- `META_CHANGE_COOLDOWN_HOURS`, по умолчанию `6`;
- `META_AUDIT_LOG_PATH`.

## Рабочий порядок

1. Проверить `meta_connection_status` и `meta_get_guardrails`.
2. Перед первой записью вызвать read-only `meta_validate_write_access`: он проверяет
   write-token через GET, наличие `ads_management` и `ads_read`, отсутствие
   `business_management`, `appsecret_proof` и видимость allow-listed аккаунта.
3. Получить кампании/группы/объявления и Insights за завершённые дни.
4. Сопоставить расходы не только с raw leads, но и со статусами Lead Hub.
5. Вызвать `meta_prepare_change` и проверить diff.
6. В guarded-режиме применить ровно этот change-set через `meta_apply_change`.
7. Проверить read-after-write и локальный журнал.

Для отдельного PAUSED bundle:

1. Проверить guardrails и подготовить exact plan через
   `meta_prepare_campaign_bundle`; этот шаг не выполняет Graph POST.
2. Проверить safe preview, lifetime budget, landing URL, catalog hash и expiry.
3. Человек вне MCP подписывает exact plan hash detached Ed25519-ключом.
4. Сначала выполнить `dry-run`; подтвердить, что ledger сохранён, а Meta не
   изменился.
5. Только после отдельного operational approval включить обе guarded-защиты и
   вызвать `meta_materialize_campaign_bundle` по opaque bundle ref.
6. Сверить каждый созданный `PAUSED` объект read-after-write. При неизвестном
   результате POST не повторять его: account lock снимается только после
   `meta_reconcile_campaign_bundle`.

Approval-файл называется строго `<bundle_ref>.approval.json` и кладётся в каталог
`META_BUNDLE_APPROVALS_PATH`. Полный 15-полевой формат показан в
`examples/campaign-bundle-approval.template.json`; template намеренно не содержит
действующей подписи. Подписываются UTF-8 bytes:

```text
bse-meta-campaign-bundle-approval/v1 || 0x00 || canonicalJson(unsigned_payload)
```

`unsigned_payload` содержит ровно первые 14 полей template, ключи canonical JSON
сортируются лексикографически, пробелы не добавляются. Подпись — 64-byte Ed25519,
закодированная как unpadded base64url. В runtime передаётся только публичный DER
SPKI key в canonical base64; signing key и генератор approval не входят в MCP.
Approval обязан повторять `bundle_ref`, exact plan hash, policy/Graph version,
opaque account scope и оба режима из safe preview; срок approval не может выходить
за срок bundle proposal.

Safe rollout: unit/contract tests без сети -> dry-run с нулём POST -> согласованный
canary на тестовом или неактивном контуре -> сверка Ads Manager и ledger. В этой
ветке live Meta writes не выполнялись; production creation остаётся выключенным.

Первый production-этап должен оставаться read-only. Запись включается только после
настройки Meta App, проверки permissions, legal/consent и согласованного smoke test
на тестовом или неактивном объекте. Activation/publish требует отдельного approval
и не входит в campaign-bundle v1.
