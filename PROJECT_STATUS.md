# Состояние проекта BelStekloExpert

Последняя актуализация: 2 августа 2026 года.

Этот файл является короткой панелью проекта. Его нужно обновлять после изменения
production-архитектуры, провайдера, режима доставки заявок или значимого ограничения.

## Сервисы

| Область | Текущее решение | Статус | Примечание |
| --- | --- | --- | --- |
| Основной сайт | Netlify, Astro SSR | Работает | Runtime cutover `dcf01d8`, режим доставки `hub`, включая `/api/health/`, проверен 28 июля 2026 года |
| Preview сайта | Cloudflare Workers, Astro SSR | Работает | Commit `669fd95`, Worker version `c4e67557-1072-49a6-a8f9-a1eeb23ea357`; static HTML и SSR защищены `noindex`, read-only smoke пройден 30 июля. На 36 вызовах активной версии CPU P50/P90/P99 составил 0,90/3,06/4,58 ms, resource errors — 0. Форма, фото и Telegram проверены 29 июля. Production DNS и Netlify не изменены |
| Репозиторий | GitHub `main` | Работает | `liber10/belstekloexpert-astro`; Cloudflare preview fix `669fd95` отправлен 30 июля 2026 года |
| Lead Hub | Render Free Web Service | Работает | Production `caf4365`; readiness, миграция multichannel inbox и Telegram callbacks проверены 2 августа 2026 года |
| Kufar | Gmail Apps Script → durable inbox Lead Hub | Работает | Production smoke test прошёл 2 августа: письмо принято один раз, текст очищен, точный диалог открывается, статусы сохраняются |
| База лидов | Neon PostgreSQL | Подключена | Pooled connection через `DATABASE_URL` |
| Фото заявок | Backblaze B2 | Работает | Закрытый bucket, signed upload/download |
| Telegram | Webhook и outbox worker Lead Hub на Render | Работает | Webhook регистрируется при старте; production smoke test доставки выполнен 28 июля 2026 года |
| Резервное object storage | Cloudflare R2 | Доступ получен | Пока не используется в production |
| Основной домен | `belstekloexpert.by` | Частично | Apex работает на Netlify; `www` не разрешается из-за ошибочного CNAME у текущего DNS-провайдера |

## Что уже реализовано

- адаптивный Astro-сайт с услугами, марками, моделями, блогом и страницей для юрлиц;
- калькулятор по прайсу с поиском марки и модели, диапазоном годов и еврокодом;
- импорт обновлённого XLSX-прайса без публикации внутренней стоимости работ;
- белорусские цены с новым обозначением рубля;
- единый поток форм через `/api/lead/`;
- автоматическое сжатие фотографий в браузере;
- приватная прямая загрузка фотографий в Backblaze B2;
- PostgreSQL как источник истины для лидов;
- идемпотентность, outbox и диагностические health endpoints;
- доставка заявок и фото в Telegram;
- приём обращений Kufar через Gmail adapter, durable inbox и source-aware Telegram-карточку;
- коммерческое предложение для юрлиц;
- favicon, `llms.txt`, JSON-LD, sitemap, robots и подтверждение Яндекс Вебмастера.

## Известные ограничения

1. Netlify ранее останавливал production-деплои из-за build-кредитов. Runtime cutover
   `dcf01d8` и последующий документационный деплой 28 июля прошли успешно, но расход
   кредитов нужно продолжать контролировать; Cloudflare остаётся планом снижения этой
   зависимости.
2. Lead Hub работает на Render Free Web Service. В проверке 30 июля один из 15
   health-запросов вернул временный HTTP 503, следующие 14 и дополнительная серия
   5/5 ответили HTTP 200. Холодный запуск после простоя остаётся риском; нужен
   мониторинг времени ответа форм и задач outbox.
3. Cloudflare preview прошёл функциональный smoke test; prerendered HTML
   обслуживается как static assets и получает host-specific `noindex`, SSR и API
   проходят через Worker. Free bundle и CPU limits пройдены: на 36 вызовах активной
   версии CPU P99 составил 4,58 ms, ошибок и превышений лимитов не было. Перед
   cutover остаётся проверить custom domain и фактический DNS rollback.
4. Исторический аудит от 10 июля описывает состояние до создания Lead Hub и хранится
   только как архив.
5. Локальное рабочее дерево может содержать пользовательские изменения. Их нельзя
   автоматически восстанавливать, удалять или включать в чужой коммит.
6. Authoritative DNS остаётся на Hoster.by. Apex работает, но
   `www.belstekloexpert.by` не разрешается; перед переносом зоны нужен полный экспорт
   записей и отдельная проверка почтовых MX/SPF/DKIM/DMARC.

## Ближайшие решения

| ID | Решение | Приоритет | Состояние |
| --- | --- | --- | --- |
| `INFRA-001` | Оценить перенос сайта с Netlify на Cloudflare Pages/Workers | P1 | В работе: preview `669fd95`, production config, static routing, bundle и CPU limits проверены; остаются DNS, custom domain и rollback |
| `DNS-001` | Исправить `www` и перенести authoritative DNS в Cloudflare без смены origin | P1 | Запланировано |
| `STORAGE-001` | Сравнить рабочий B2 с Cloudflare R2 и подготовить план миграции | P1 | Запланировано |
| `LEADS-001` | Переключить Telegram webhook и outbox worker полностью на Lead Hub | P1 | Выполнено |
| `KUFAR-001` | Перевести Kufar email handler на durable Lead Hub inbox | P1 | Выполнено, production smoke test 2 августа 2026 года |
| `TELEGRAM-LEADS-001` | Добавить отдельного публичного Telegram-бота для клиентов | P1 | Реализация и миграция подготовлены с feature flag off; production enable заблокирован `LEGAL-001` |
| `META-001` | Подключить Meta Instant Forms к durable inbox | P1 | Запланировано; нужны Meta App и решение `LEGAL-001` |
| `LEGAL-001` | Утвердить privacy policy, consent и срок хранения PII | P1 | Требует решения владельца |
| `OPS-001` | Добавить CI для проверок сайта и Lead Hub | P2 | Backlog |
| `ADS-001` | Подключать рекламные конверсии только после consent и стабильного Lead Hub | P2 | Заблокировано `LEGAL-001` |

Подробный список находится в [docs/roadmap.md](docs/roadmap.md).

## Правило актуализации

После значимого production-изменения нужно:

1. обновить таблицу сервисов и ограничений;
2. при необходимости создать или обновить ADR в `docs/decisions/`;
3. отметить выполненную задачу в `docs/roadmap.md`;
4. указать проверенный commit SHA;
5. не записывать сюда секреты, внутренние цены и персональные данные клиентов.
