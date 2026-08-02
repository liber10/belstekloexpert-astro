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
| [Аудит персональных данных](personal-data-audit.md) | Legal/operations | Проект `LEGAL-001` |
| [Обязательные legal-входы](legal-required-inputs.md) | Checklist | Блокирует publication |
| [Карта информационных ресурсов](personal-data-resources-map.md) | Registry | Требует проверки владельцем |
| [Meta Lead Ads: legal copy](meta-lead-ads-legal-copy.md) | Advertising | Проект, legal review required |
| [Чек-лист рекламы](advertising-compliance-checklist.md) | Advertising | Проект |
| [Cloudflare preview runbook](cloudflare-preview-runbook.md) | Operations | Актуальный |
| [Cloudflare production cutover](cloudflare-cutover-runbook.md) | Operations | Подготовлен, cutover не утверждён |
| [Обновление прайса](price-update.md) | Operations | Актуальный |
| [ADR-0001: границы монорепозитория](decisions/0001-monorepo-boundaries.md) | Decision | Принят |
| [ADR-0002: два Astro runtime](decisions/0002-dual-astro-runtime.md) | Decision | Принят |
| [ADR-0003: Cloudflare Worker preview](decisions/0003-cloudflare-migration-candidate.md) | Decision | Принят для preview |

## Исторические документы

| Документ | Период | Назначение |
| --- | --- | --- |
| [Аудит контура заявок](archive/lead-hub-audit-2026-07-10.md) | 10 июля 2026 | Состояние до создания Lead Hub |

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
