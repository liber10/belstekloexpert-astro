# Meta marketing operations runbook

Статус: подготовка; live ads/content writes не разрешены.

Дата актуализации: 15 августа 2026 года.

Документ описывает единый процесс рекламы, органического контента и обратной связи
по качеству лидов. Он не заменяет legal review и не выдаёт агенту права Business
Admin, billing или finance.

## Модель ответственности

| Роль | Ответственность |
| --- | --- |
| Владелец бизнеса | Утверждает оффер, бюджетный cap, targeting template и первую публикацию |
| Мастер / SME | Подтверждает технические claims, ремонтопригодность, цену, срок и ограничения |
| Legal / privacy owner | Утверждает copy, consent, retention, transfer и права на материалы |
| Контент-оператор | Готовит briefs, исходники, права, Page/IG variants и календарь |
| Meta agent | Анализирует, валидирует spec, создаёт preview/draft/PAUSED objects, мониторит и предлагает изменения |
| Lead Hub | Хранит лиды, PII, статусы, фото и attribution; наружу отдаёт только агрегаты качества |

Human Business Admin с 2FA остаётся break-glass владельцем активов и единственным,
кто назначает роли. Runtime agent не управляет пользователями, billing, finance,
custom audiences или business settings.

## Изолированные service identities

Один логический агент использует разные principals и tokens. Универсальный
super-token запрещён.

| Principal | Assets/tasks | Runtime permissions | Запрещено |
| --- | --- | --- | --- |
| `observer` | allow-listed ad account, `ANALYZE` | `ads_read` | любые writes |
| `ads-operator` | конкретный ad account, `ADVERTISE` + `ANALYZE`; Page advertising task только при необходимости | `ads_management`, `ads_read` и подтверждённые зависимости | Page posts, leads, roles, billing |
| `content-publisher` | конкретная Facebook Page `CREATE_CONTENT` + `ANALYZE`, linked professional Instagram | фактически доступные `pages_manage_posts`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`; дополнительные scopes только по функции | ad account, lead retrieval, roles |
| `lead-ingest` | конкретная Page/Form и Leads Access | `leads_retrieval`, минимальные Page/webhook scopes, подтверждённые live app | ads/content writes |
| `conversion-uploader` | конкретный Dataset/CAPI asset | минимальный event-upload access | ad/Page/lead read |

Meta Posts guide от 17 апреля 2026 года содержит имя
`pages_read_user_engagement`, отсутствующее в текущем Permissions Reference.
Не запрашивать его вслепую: реальный набор проверяется в App Dashboard/Token
Debugger; для чтения user content используется доступный
`pages_read_user_content`, только если функция действительно нужна.

Токены:

- только secret store, никогда Git, Markdown, browser storage или лог;
- отдельные prod/test credentials;
- expiring token и ротация не реже срока, который показывает Meta;
- revoke drill и inventory owner/created/expires/last-used;
- `appsecret_proof` для server-side Graph calls;
- изменение permission или asset assignment требует отдельного human approval.

## Рабочий цикл рекламы

```text
brief -> evidence/legal -> CampaignSpec -> preview/dry-run
      -> human approval exact hash -> create PAUSED -> reconcile
      -> second human approval -> schedule/publish -> 1h/24h/72h checks -> learn
```

1. Brief фиксирует цель, KPI качества, оффер, landing URL, аудиторию, бюджетный
   cap, creative matrix, owner и expiry.
2. Agent собирает completed-day Insights и агрегаты Lead Hub; PII и фото ему не
   выдаются.
3. Validator отклоняет неизвестные поля, неразрешённый домен, claims без evidence,
   asset без rights metadata и budget выше cap.
4. Preview показывает точные copy, creative, CTA, URL, UTM, targeting, placements,
   schedule и spend limits.
5. Approval хранит actor, spec hash, policy version, решение и expiry вне MCP.
6. Campaign/ad set/creative/ad создаются только `PAUSED`; каждый POST имеет
   idempotency record и provider reconciliation.
7. Перед запуском Ads Manager сверяется с approved spec. Leaf objects включаются
   первыми, root campaign — последней; при частичном сбое root остаётся paused.
8. После публикации выполняются read-after-write и smoke формы/attribution.
9. Изменения в learning phase минимизируются; один тест меняет один основной
   фактор и работает не менее семи полных дней, если нет stop-condition.

Первый bounded autopilot может только pause или уменьшить бюджет в пределах
policy. Resume, увеличение бюджета, новый targeting, создание новой кампании и
первая публикация всегда требуют нового approval.

### Локальный PAUSED campaign-bundle v1

Реализация v1 ограничена одним allow-listed сценарием: Website campaign с
objective `OUTCOME_LEADS`, одним ad set и 1–3 ads. Campaign, ad set и ads создаются
только `PAUSED`; creative не имеет delivery status. Контур не умеет
activation/publish/delete, media upload, Instant Forms, arbitrary targeting или
изменение catalog assets.

Вход содержит только логические ключи. Фактические Page, Pixel, pre-uploaded media
и broad location targeting template читаются из строгого внешнего JSON catalog;
landing host берётся из отдельного allowlist. Catalog и policy хешируются, а exact
plan связывается с account, Graph version, обоими write modes и expiry. Policy v1
также требует ожидаемые currency/timezone `USD` / `Europe/Minsk`.

Approval создаётся человеком вне MCP как detached Ed25519 signature. В окружении
плагина хранится только публичный ключ; signing key, approval generator и approval
secret агенту недоступны. Состояние сохраняется в durable ledger. Неизвестный
результат Graph POST ставит account-level lock: автоматический повтор запрещён до
provider reconciliation.

Approval-файл имеет имя `<bundle_ref>.approval.json` и хранится только в
`META_BUNDLE_APPROVALS_PATH`. Он содержит строгие 15 полей из plugin template;
подписываются domain-separated canonical JSON bytes без поля `signature`. Формат и
interoperability bytes описаны в plugin README и проверяются unit-тестом с
Ed25519-ключом. Приватный signing key не размещается рядом с runtime или Codex.

Отдельные настройки v1:

- `META_CAMPAIGN_BUNDLE_MODE=off|dry-run|guarded`, default `off`;
- `META_BUNDLE_CREATION_ENABLED` — дополнительный kill switch;
- `META_MAX_BUNDLE_LIFETIME_BUDGET_MINOR` — lifetime cap;
- `META_BUNDLE_PROPOSAL_TTL_MINUTES` — срок exact plan;
- `META_BUNDLE_STATE_DIR` — абсолютный путь durable ledger/locks;
- `META_BUNDLE_ASSET_CATALOG_PATH` — абсолютный путь strict asset catalog;
- `META_BUNDLE_APPROVALS_PATH` — абсолютный каталог detached approvals;
- `META_BUNDLE_APPROVAL_PUBLIC_KEY_B64` — public Ed25519 verification key;
- `META_BUNDLE_POLICY_VERSION` — версия policy;
- `META_ALLOWED_LANDING_HOSTS` — точные разрешённые HTTPS-hosts.

Guarded materialize разрешается только если одновременно действуют
`META_WRITE_MODE=guarded`, `META_CAMPAIGN_BUNDLE_MODE=guarded`, creation kill
switch, lifetime cap, стабильные абсолютные paths, валидный catalog и действующий
approval. `autopilot` никогда не включает создание.

Safe rollout выполняется строго по этапам:

1. unit/contract tests с запретом реальной сети;
2. `off`, затем dry-run с доказанным нулём Graph POST;
3. проверка catalog, preview, signature, expiry, ledger и restart recovery;
4. отдельное согласование canary на тестовом или неактивном контуре;
5. materialize и сверка всех `PAUSED` objects в Ads Manager;
6. отдельное решение о publish/activation вне v1.

Код v1 реализован и локально протестирован в implementation-ветке; production
creation по-прежнему выключен, installation/canary не выполнены и live Meta writes
в рамках разработки не выполнялись.

## Рабочий цикл органического контента

```text
weekly brief -> asset intake -> rights/claims -> FB + IG variants
             -> preview -> human approval exact hash -> schedule
             -> publish confirmation -> moderation -> 24h/72h learning
```

### Базовый ритм

- 1 Reel в неделю: процесс, диагностика или совет мастера;
- 1 карусель/пост: before/after только с release либо нейтральный образовательный
  разбор;
- 1 FAQ/offer post: запись, сезонный риск, уход за стеклом;
- Stories в дни, когда есть свежий безопасный материал и возможность ответить.

Публикации не создаются ради календарной нормы. Контент-план поддерживает четыре
потока: `education`, `proof`, `service`, `response`. За один месяц должны быть
разные hooks, форматы и стадии funnel, а не повторы одного макета.

### Требования к материалам

- Reels: нативный 9:16, звук/royalty-safe audio, ключевые элементы в safe zone;
- Feed: отдельный 4:5 вариант; alt text для изображений;
- клиентские номера, лица, документы, геометки и EXIF удалены;
- rights/release и source записаны до staging;
- AI-generated/edited материал отмечен во внутреннем provenance и проходит
  проверку фактических claims;
- media для publishing хранится отдельно от private B2 lead photos. Instagram API
  получает только утверждённый public/accessible publishing asset, никогда signed
  lead URL.

Facebook Pages API поддерживает немедленную и запланированную публикацию; текущий
guide указывает окно 10 минут–30 дней. Instagram Content Publishing поддерживает
professional accounts и требует доступного Meta медиаисточника. Каждый канал имеет
отдельную copy/asset version и отдельный preview.

## Naming и attribution

Campaign:
`BSE | <OBJECTIVE> | <OFFER> | <LOCATION> | <CONVERSION> | <YYYY-MM>`.

Ad set:
`<AUDIENCE_TEMPLATE> | <PLACEMENTS> | <OPTIMIZATION> | v<N>`.

Ad:
`<CONCEPT> | <FORMAT> | <HOOK> | v<N>`.

UTM:

- `utm_source=meta`;
- `utm_medium=paid_social` или `organic_social`;
- `utm_campaign=<stable_slug>`;
- `utm_content=<creative_slug>`.

Raw provider IDs хранятся только в защищённом mapping слое. Agent и отчёты
используют opaque refs. Для quality analysis cohort строится по времени создания
лида и stage timestamps, а не только по текущему статусу.

## Контроль качества и cadence

### После каждого запуска

- через 1 час: delivery state, URL, form smoke, attribution, spend anomaly;
- через 24 часа: комментарии, отклонения Meta, CTR/CPM/frequency и intake SLA;
- через 72 часа: первые qualified outcomes без преждевременного скейлинга;
- после 7 полных дней: решение keep/change/stop по qualified/booked/won cohort.

### Еженедельно

1. Сверка Meta spend с Ads Manager.
2. Funnel: raw -> reachable -> qualified -> booked -> won.
3. Creative fatigue и distribution по placements.
4. Очередь комментариев/сообщений и response SLA.
5. Один следующий learning question; не пакет одновременных изменений.

### Ежемесячно

- rights/release audit;
- token expiry и unused permissions;
- budget caps и kill switches;
- data retention/deletion и webhook failures;
- контентные темы, которые дали qualified demand, а не только engagement.

## Инциденты и rollback

Немедленный pause principal/campaign выполняется при:

- утечке или неправильной обработке PII/фото;
- неверном advertiser/offer/price/guarantee;
- превышении spend cap;
- битой форме, attribution или потере лидов;
- публикации неутверждённого asset/copy;
- неизвестном результате Graph POST, который не удалось reconcile.

Порядок: включить kill switch, pause root, не повторять неизвестный POST вслепую,
сохранить sanitized execution evidence, уведомить владельца, отозвать token при
подозрении на compromise и только после reconciliation готовить новый proposal.

## Современные источники, проверенные в августе 2026 года

- [System User permissions](https://developers.facebook.com/docs/business-management-apis/system-users/guides/permissions)
- [Meta permissions reference](https://developers.facebook.com/docs/permissions)
- [Facebook Page publishing, обновлено 17.04.2026](https://developers.facebook.com/documentation/pages-api/posts)
- [Instagram publishing, обновлено 30.06.2026](https://developers.facebook.com/documentation/instagram-platform/content-publishing)
- [Meta Performance 5](https://www.facebook.com/business/ads/performance-marketing)
- [Advantage+ leads](https://www.facebook.com/business/ads/meta-advantage-plus/leads)
- [Reels ads](https://www.facebook.com/business/ads/facebook-instagram-reels-ads)

Текущие guides уже показывают Graph API v26.0, а локальный плагин зафиксирован на
v25.0. Upgrade выполняется отдельной задачей после capability probe и contract
tests; молчаливое переключение версии запрещено.
