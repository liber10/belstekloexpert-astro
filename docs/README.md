# Документация BelStekloExpert

Этот каталог является единой точкой входа в подробную документацию проекта.

## Текущие документы

| Документ | Тип | Статус |
| --- | --- | --- |
| [Состояние проекта](../PROJECT_STATUS.md) | Dashboard | Актуальный |
| [Архитектура](architecture.md) | Architecture | Актуальный |
| [Roadmap](roadmap.md) | Planning | Актуальный |
| [Lead Hub runbook](lead-hub-runbook.md) | Operations | Актуальный |
| [Публичный Telegram-бот](public-telegram-bot-runbook.md) | Operations | Подготовка; production заблокирован `LEGAL-001` |
| [Instagram Messaging MVP](meta-messaging-runbook.md) | Operations | Meta ingress работает; outbound выключен после ошибочного ответа в старом диалоге |
| [Аудит персональных данных](personal-data-audit.md) | Legal/operations | Проект `LEGAL-001` |
| [Обязательные legal-входы](legal-required-inputs.md) | Checklist | Блокирует publication |
| [Карта информационных ресурсов](personal-data-resources-map.md) | Registry | Требует проверки владельцем |
| [Meta Lead Ads: legal copy](meta-lead-ads-legal-copy.md) | Advertising | Проект; ingestion не подключён, legal review и проверка photo-flow обязательны |
| [Meta campaign brief: ремонт сколов](meta-chip-repair-campaign-brief.md) | Advertising | Проект; publication blocked |
| [Рыночный ориентир ремонта скола](meta-chip-repair-pricing-evidence-2026-08-15.md) | Advertising evidence | Исторический snapshot; срок claim истёк 15 сентября 2026 года |
| [Meta marketing operations](meta-marketing-operations-runbook.md) | Operations | Подготовка; live writes выключены |
| [Чек-лист рекламы](advertising-compliance-checklist.md) | Advertising | Проект |
| [Cloudflare preview runbook](cloudflare-preview-runbook.md) | Operations | Актуальный, отдельный `noindex` Worker |
| [Cloudflare production runbook](cloudflare-cutover-runbook.md) | Operations | Актуальный, cutover выполнен |
| [Обновление прайса](price-update.md) | Operations | Актуальный |
| [Данные по ремонту сколов](chip-repair-offer-inputs.md) | Product checklist | Ожидает подтверждения мастера |
| [ADR-0001: границы монорепозитория](decisions/0001-monorepo-boundaries.md) | Decision | Принят |
| [ADR-0002: два Astro runtime](decisions/0002-dual-astro-runtime.md) | Decision | Принят |
| [ADR-0003: Cloudflare Worker preview](decisions/0003-cloudflare-migration-candidate.md) | Decision | Выполнен; историческая база миграции |
| [ADR-0004: Meta Ads control plane](decisions/0004-meta-ads-control-plane.md) | Decision | Принят для локального этапа; production write выключен |
| [ADR-0005: Cloudflare production frontend](decisions/0005-cloudflare-production.md) | Decision | Принят и введён в эксплуатацию |
| [ADR-0006: Meta marketing agent](decisions/0006-meta-marketing-agent.md) | Decision | Принят для staged implementation; production publish не утверждён |
| [ADR-0007: Instagram read-only boundary](decisions/0007-instagram-read-only-boundary.md) | Decision | Принят для локальной проверки; production outbound не утверждён |
| [ADR-0008: Instagram Messaging MVP](decisions/0008-instagram-messaging-mvp.md) | Decision | Локально реализован; production требует отдельного approval |
| [ADR-0009: новый Instagram-диалог](decisions/0009-instagram-first-conversation-guard.md) | Decision | Fail-closed проверка истории реализована локально; outbound выключен |

## Исторические документы

| Документ | Период | Назначение |
| --- | --- | --- |
| [Аудит контура заявок](archive/lead-hub-audit-2026-07-10.md) | 10 июля 2026 | Состояние до создания Lead Hub |
| [Аудит Meta Ads](archive/meta-ads-audit-2026-08-03-to-2026-08-14.md) | 3–14 августа 2026 | Read-only evidence и baseline до quality attribution |

Исторические документы полезны для понимания причин изменений, но не являются
источником текущего состояния.

## Правила

- Текущая информация не должна одновременно поддерживаться в нескольких файлах.
- Статус сервисов находится в `PROJECT_STATUS.md`.
- Задачи и приоритеты находятся в `roadmap.md`.
- Причины архитектурных решений находятся в `decisions/`.
- Пошаговые эксплуатационные действия находятся в runbook.
- Документы именуются строчными латинскими буквами через дефис.
- В документации нельзя хранить значения секретов, signed URL, внутренние цены и
  персональные данные.

## Жизненный цикл документа

1. Новый документ получает владельца темы и понятное назначение.
2. После изменения production-инфраструктуры обновляются status и профильный runbook.
3. Значимое необратимое решение получает ADR.
4. Устаревший материал перемещается в `archive/` с датой и предупреждением.
