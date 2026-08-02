# Roadmap BelStekloExpert

Последняя актуализация: 2 августа 2026 года.

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
| `OPS-001` | CI | Автоматизировать проверки сайта и Lead Hub в GitHub Actions | P2 | backlog |
| `LEGAL-001` | Данные | Утвердить privacy policy, consent и retention | P1 | in-progress — аудит, policy/consent/cookie implementation готовы в ветке; сроки, адрес, контакты и трансграничные получатели ждут подтверждения |
| `LEADS-001` | Lead Hub | Перевести Telegram webhook и outbox worker полностью на Render | P1 | done |
| `KUFAR-001` | Lead Hub | Перевести Kufar email handler на durable inbox и source-aware Telegram-карточки | P1 | done |
| `TELEGRAM-LEADS-001` | Lead Hub | Добавить отдельного публичного Telegram-бота для клиентских заявок | P1 | in progress — код и миграция готовы с feature flag off; production enable ждёт `LEGAL-001` |
| `META-001` | Lead Hub | Подключить только Meta Instant Forms через подписанный webhook | P1 | blocked |

## Инфраструктура

| ID | Задача | Приоритет | Статус | Условие готовности |
| --- | --- | --- | --- | --- |
| `INFRA-001` | Перенести frontend с Netlify на Cloudflare Workers | P1 | in-progress | Preview, SSR/API, формы с фото, домен и rollback проверены |
| `DNS-001` | Исправить `www` и перенести authoritative DNS в Cloudflare без смены origin | P1 | planned | Apex, `www` и почтовые записи проверены, сайт остаётся на Netlify |
| `STORAGE-001` | Оценить миграцию B2 → Cloudflare R2 | P1 | planned | Старые refs совместимы или объекты перенесены |
| `OPS-002` | Добавить мониторинг health и outbox dead jobs | P2 | backlog | Есть уведомление о сбое |
| `OPS-003` | Зафиксировать backup/restore Neon | P2 | backlog | Выполнен тест восстановления |

Переход на Cloudflare нужно напомнить при следующем инфраструктурном этапе. Причина:
Netlify уже останавливал production-деплои из-за build-кредитов, а владелец проекта
зарегистрировал Cloudflare и получил доступ к R2.

Для `INFRA-001` опубликован изолированный Worker preview
`belstekloexpert-preview.belstekloexpert.workers.dev`. Страницы, `noindex`,
`/api/health/`, форма без фото и форма с фото 15,5 МБ проверены 29 июля 2026 года.
Подтверждены автоматическое сжатие, signed upload в закрытый B2 и доставка outbox
в Telegram. 30 июля добавлены отдельная production-конфигурация, read-only smoke и
оптимизированная раздача static assets. Commit `669fd95` повторно опубликован в
preview: static HTML и SSR получают `noindex`, health и lead endpoint прошли
проверку; действующий Netlify production остался indexable и также прошёл
read-only smoke. Free bundle limit пройден; до завершения остаются DNS migration,
custom domain и фактический rollback. На 36 вызовах активной версии Worker CPU
P50/P90/P99 составил 0,90/3,06/4,58 ms, ошибок и превышений resource limits не
было. Один из 15 health-запросов получил временный HTTP 503 во время обращения к
Render; следующие 14 и дополнительная серия 5/5 завершились HTTP 200. Production
DNS не изменялся.

## Сайт и продукт

| ID | Задача | Приоритет | Статус |
| --- | --- | --- | --- |
| `WEB-001` | Проверить ключевые страницы на mobile и desktop после следующих UI-изменений | P1 | planned |
| `CALC-001` | Формализовать версию прайса и дату актуальности в pipeline | P2 | backlog |
| `CALC-002` | Добавить безопасный preview отчёта перед публикацией нового прайса | P2 | backlog |
| `B2B-001` | Расширить форму юрлиц компанией, УНП, размером парка и email | P2 | backlog |
| `CONTENT-001` | Вести контент-план страниц услуг и блога | P3 | backlog |

## Аналитика и реклама

| ID | Задача | Приоритет | Статус |
| --- | --- | --- | --- |
| `ANALYTICS-001` | Проверить отсутствие дублей целей GA4/GTM/Метрики | P2 | backlog |
| `ANALYTICS-002` | Добавить consent-aware события калькулятора и форм | P2 | blocked |
| `ADS-001` | Подключить offline conversions после стабилизации статусов | P2 | blocked |

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
