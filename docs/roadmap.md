# Roadmap BelStekloExpert

Последняя актуализация: 17 сентября 2026 года.

## Обозначения

- `P0`: блокирует работу или сохранность заявок;
- `P1`: следующий важный этап;
- `P2`: улучшение после стабилизации;
- `P3`: идея без согласованного срока.

Статусы: `backlog`, `planned`, `in-progress`, `blocked`, `done`.

## Сейчас

| ID | Область | Задача | Приоритет | Статус |
| --- | --- | --- | --- | --- |
| `DOCS-001` | Проект | Единый README, status, architecture, roadmap и AGENTS | P1 | done |
| `OPS-004` | Health | Перевести site health с прямого PostgreSQL на readiness Lead Hub | P1 | done |
| `OPS-001` | CI | Автоматизировать проверки сайта и Lead Hub в GitHub Actions | P2 | done — два параллельных job без секретов и автодеплоя |
| `LEGAL-001` | Данные | Утвердить privacy policy, consent и retention | P1 | in-progress — политика, consent evidence и cookie controls live; остаются регламент удаления во всех копиях и проверка Реестра операторов |
| `LEADS-001` | Lead Hub | Перевести Telegram webhook и outbox worker полностью на Render | P1 | done |
| `KUFAR-001` | Lead Hub | Перевести Kufar email handler на durable inbox и source-aware Telegram-карточки | P1 | done |
| `TELEGRAM-LEADS-001` | Lead Hub | Добавить отдельного публичного Telegram-бота для клиентских заявок | P1 | in progress — код и миграция готовы с feature flag off; production enable ждёт `LEGAL-001` |
| `META-001` | Lead Hub | Подключить Meta Instant Forms через подписанный webhook | P1 | blocked — `LEGAL-001`, app review и lead-access permissions |
| `META-MESSAGING-001` | Lead Hub | Подключить Meta DM webhook к durable inbox и отдельно согласовать auto-reply | P0 | in-progress — signed ingest интегрирован локально в `493d4dd`, production feature flag off |
| `META-PHOTO-001` | Сайт / Lead Hub | Подготовить рекламный photo-flow ремонта сколов на существующую private site/B2 форму | P1 | planned — consent-aware measurement и mobile E2E smoke |
| `META-IDENTITY-001` | Meta | Разделить service identities для ads, publishing и lead retrieval | P1 | in-progress — Employee `ads-operator` имеет точечный доступ и отдельный token с `ads_management` + `ads_read` без `business_management`; Instagram publishing и lead-retrieval identities не созданы |
| `CONTENT-001` | Контент | Ввести календарь, approval, Page/IG publishing, moderation и weekly learning | P1 | planned |

## Инфраструктура

| ID | Задача | Приоритет | Статус | Условие готовности |
| --- | --- | --- | --- | --- |
| `INFRA-001` | Перенести frontend с Netlify на Cloudflare Workers | P1 | done | Production Worker, custom domain, SSR/API, static assets и rollback-путь проверены |
| `DNS-001` | Исправить `www` и перенести authoritative DNS в Cloudflare | P1 | done | Cloudflare authoritative DNS; apex и `www` резолвятся |
| `STORAGE-001` | Оценить миграцию B2 → Cloudflare R2 | P1 | planned | Старые refs совместимы или объекты перенесены |
| `OPS-002` | Добавить мониторинг health и outbox dead jobs | P2 | backlog | Есть уведомление о сбое |
| `OPS-003` | Зафиксировать backup/restore Neon | P2 | backlog | Выполнен тест восстановления |

Для `INFRA-001` сначала был опубликован изолированный Worker preview
`belstekloexpert-preview.belstekloexpert.workers.dev`. Страницы, `noindex`,
`/api/health/`, форма без фото и форма с фото 15,5 МБ проверены 29 июля 2026 года.
Подтверждены автоматическое сжатие, signed upload в закрытый B2 и доставка outbox
в Telegram. 30 июля добавлены отдельная production-конфигурация, read-only smoke и
оптимизированная раздача static assets. Commit `669fd95` повторно опубликован в
preview: static HTML и SSR получают `noindex`, health и lead endpoint прошли
проверку. Затем authoritative DNS, apex и `www` были перенесены в Cloudflare, а
`belstekloexpert-production` стал production frontend. Free bundle limit пройден.
На 36 вызовах preview Worker CPU
P50/P90/P99 составил 0,90/3,06/4,58 ms, ошибок и превышений resource limits не
было. Один из 15 health-запросов получил временный HTTP 503 во время обращения к
Render; следующие 14 и дополнительная серия 5/5 завершились HTTP 200. Production
релизы теперь проходят Cloudflare build, Wrangler dry-run, deploy и read-only smoke.

## Сайт и продукт

| ID | Задача | Приоритет | Статус |
| --- | --- | --- | --- |
| `WEB-001` | Проверить ключевые страницы на mobile и desktop после следующих UI-изменений | P1 | done — 6 production-страниц при 1280 и 390 px, переполнения и запрещённых цен нет |
| `WEB-002` | Перевести быструю оценку на марку, модель, год и фото; усилить ремонт сколов | P1 | done — релиз `604e78e`, resilience fix `49f449a`, Worker `7727d9ed`; photo-flow и идемпотентность проверены |
| `CALC-001` | Формализовать версию прайса и дату актуальности в pipeline | P2 | backlog |
| `CALC-002` | Добавить безопасный preview отчёта перед публикацией нового прайса | P2 | backlog |
| `B2B-001` | Расширить форму юрлиц компанией, УНП, размером парка и email | P2 | backlog |
| `CONTENT-WEB-001` | Вести контент-план страниц услуг и блога | P2 | planned |

## Аналитика и реклама

| ID | Задача | Приоритет | Статус |
| --- | --- | --- | --- |
| `ANALYTICS-001` | Проверить отсутствие дублей целей GA4/GTM/Метрики | P2 | backlog |
| `ANALYTICS-002` | Добавить consent-aware события калькулятора и форм | P2 | blocked |
| `ADS-001` | Подключить offline/conversion leads events после стабилизации статусов | P2 | blocked — `LEGAL-001`, `META-001` и схема quality events |
| `ADS-CHIP-001` | Запустить отдельный эксперимент ремонта сколов | P1 | blocked — `META-PHOTO-001`, `LEGAL-001` и подтверждение `chip-repair-offer-inputs.md` |
| `META-CONTROL-001` | Подключить repo-local Meta Ads plugin: read audit, dry-run и guarded writes | P1 | in-progress — plugin интегрирован локально в `991a76f`; observe/Insights и прошлый dry-run smoke подтверждены, default-off PAUSED campaign-bundle v1 прошёл 72/72 теста и validator; install/canary и production write не утверждены |
| `META-AGENT-001` | Реализовать staged full-cycle ads/content agent | P1 | in-progress — ADR-0006 принят; локальный PAUSED materializer/ledger/reconciliation реализован, но production canary, activation, publishing connector и quality feedback остаются blocked |

`META-CONTROL-001` не заменяет `META-001` и `ADS-001`. Автоматическое управление
разрешается поэтапно: `observe -> plan -> guarded apply -> bounded autopilot`.
Первый autopilot допускает только pause и уменьшение бюджета в пределах policy;
resume, увеличение бюджета, targeting, публикация и delete требуют отдельного решения.

Полный цикл разбит на независимые контуры: Ads Management, Page/Instagram
Publishing и Lead Retrieval. Один универсальный admin-token не используется.
Ближайший безопасный этап — установить обновлённый plugin build, повторно доказать
нулевые POST в dry-run и провести отдельно согласованный canary на тестовом или
неактивном контуре. После materialize владелец отдельно подтверждает первую
публикацию и бюджет; activation не входит в v1.


## Выполненные этапы

- Astro-сайт и контентная структура;
- калькулятор по модели и прайсу;
- импорт XLSX и приватная внутренняя часть расчёта;
- Lead Hub MVP;
- PostgreSQL health check;
- подключение форм к Lead Hub;
- безопасная диагностика доставки;
- Backblaze B2, CORS и signed uploads;
- автоматическое сжатие больших фото;
- production smoke test сайта, B2, Render и Telegram;
- production webhook Telegram и outbox worker на Render;
- Kufar Gmail adapter, durable inbox, дедупликация, точная ссылка на диалог и production smoke test;
- документационный слой проекта.

## Как добавлять задачи

Новая задача получает:

1. стабильный ID по области;
2. один ожидаемый результат;
3. приоритет и статус;
4. явную зависимость, если она заблокирована;
5. критерий готовности для инфраструктурных изменений.

Подробную реализацию не нужно хранить в roadmap. Она относится к GitHub issue,
спецификации или отдельной задаче Codex.
