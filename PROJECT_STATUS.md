# Состояние проекта BelStekloExpert

Последняя актуализация: 21 сентября 2026 года.

Этот файл является короткой панелью проекта. Его нужно обновлять после изменения
production-архитектуры, провайдера, режима доставки заявок или значимого ограничения.

## Сервисы

| Область | Текущее решение | Статус | Примечание |
| --- | --- | --- | --- |
| Основной сайт | Cloudflare Workers, Astro SSR | Работает | Worker `belstekloexpert-production`, custom domain `belstekloexpert.by`, режим доставки `hub`; активная версия `7727d9ed-41f1-414a-8024-c64093312d76`, commit `49f449a` |
| Preview сайта | Cloudflare Workers, Astro SSR | Работает | Отдельный Worker `belstekloexpert-preview`; static HTML и SSR защищены `noindex`, форма с фото и Telegram проверены |
| Репозиторий | GitHub `main` | Работает | `liber10/belstekloexpert-astro`; Cloudflare production публикуется явно через Wrangler после проверок |
| Lead Hub | Render Free Web Service | Работает | Production `cae7eef`; readiness и миграция public Telegram session/outbox проверены 2 августа 2026 года |
| Kufar | Gmail Apps Script → durable inbox Lead Hub | Работает | Production smoke test прошёл 2 августа: письмо принято один раз, текст очищен, точный диалог открывается, статусы сохраняются |
| База лидов | Neon PostgreSQL | Подключена | Pooled connection через `DATABASE_URL` |
| Фото заявок | Backblaze B2 | Работает | Закрытый bucket, signed upload/download |
| Telegram | Webhook и outbox worker Lead Hub на Render | Работает | Webhook регистрируется при старте; production smoke test доставки выполнен 28 июля 2026 года |
| Meta DM lead-ingest | Lead Hub signed webhook + durable inbox (feature flag off) | Локально интегрировано | Commit `493d4dd`; входящие Instagram/Facebook messages принимаются, дедуплицируются и передаются в существующий Telegram outbox; `npm run lead-hub:check` проходит, production rollout и автоответ выключены |
| Публичный Telegram-бот | Отдельный webhook, FSM и outbox Lead Hub | Выключен | Код и миграция `cae7eef` live; `TELEGRAM_PUBLIC_ENABLED=false`, включение ждёт `LEGAL-001` и smoke test |
| Meta Ads control plane | Repo-local guarded MCP | Локально интегрирован; repository default off | Commit `991a76f`; один allow-listed активный аккаунт ранее прошёл read/dry-run smoke; campaign-bundle v1 прошёл 72/72 локальных теста и plugin validator, live Meta writes не выполнялись |
| Meta Page / Instagram publishing | Read-only Instagram identity boundary локально подготовлен | Подготовка | `META_INSTAGRAM_ACCESS_TOKEN` отделён от Ads-токенов; publishing, auto-reply и production permissions не подключены |
| Резервное object storage | Cloudflare R2 | Доступ получен | Пока не используется в production |
| Основной домен | `belstekloexpert.by` | Работает | Authoritative DNS: Cloudflare; apex и `www` резолвятся через Cloudflare |

## Что уже реализовано

- адаптивный Astro-сайт с услугами, марками, моделями, блогом и страницей для юрлиц;
- калькулятор по прайсу с поиском марки и модели, диапазоном годов и еврокодом;
- основной сценарий оценки по марке, модели, году и фотографии лобового стекла;
- расширенная SEO-страница ремонта сколов и инструкция по фотографированию повреждения;
- импорт обновлённого XLSX-прайса без публикации внутренней стоимости работ;
- белорусские цены с новым обозначением рубля;
- единый поток форм через `/api/lead/`;
- автоматическое сжатие фотографий в браузере;
- приватная прямая загрузка фотографий в Backblaze B2;
- PostgreSQL как источник истины для лидов;
- идемпотентность, outbox и диагностические health endpoints;
- доставка заявок и фото в Telegram;
- приём обращений Kufar через Gmail adapter, durable inbox и source-aware Telegram-карточку;
- подписанный Meta DM webhook с allow-list, raw-body signature verification,
  durable inbox, retry/dead-letter и безопасным event trace; outbound Meta replies
  не включены;
- отдельный контур публичного Telegram-бота с PostgreSQL-сессиями, consent gate и attribution, выключенный feature flag;
- коммерческое предложение для юрлиц;
- подключение Meta Ads, аудит завершённых дней 3–14 августа 2026 года и
  `prepare -> dry-run apply -> audit` smoke на завершившейся кампании без изменения
  рекламных объектов;
- favicon, `llms.txt`, JSON-LD, sitemap, robots и подтверждение Яндекс Вебмастера.
- GitHub Actions CI для production-сборки Cloudflare, тестов сайта и полного check Lead Hub.

## Известные ограничения

1. Frontend перенесён на Cloudflare Workers. Netlify-конфигурация сохранена только
   как legacy fallback и не считается текущим production origin. После значимых
   релизов нужно контролировать Worker errors, CPU и число запросов.
2. Lead Hub работает на Render Free Web Service. В проверке 30 июля один из 15
   health-запросов вернул временный HTTP 503, следующие 14 и дополнительная серия
   5/5 ответили HTTP 200. Холодный запуск после простоя остаётся риском; нужен
   мониторинг времени ответа форм и задач outbox. Frontend повторяет один временно
   неуспешный запрос подготовки фото или создания лида с теми же идентификаторами.
3. Production и preview используют отдельные Workers. Preview получает `noindex`,
   production custom domain остаётся indexable. Быстрый rollback выполняется на
   предыдущую Worker version; возврат DNS на legacy origin является аварийным
   сценарием и не совмещается с изменением object storage.
4. Исторический аудит от 10 июля описывает состояние до создания Lead Hub и хранится
   только как архив.
5. Локальное рабочее дерево может содержать пользовательские изменения. Их нельзя
   автоматически восстанавливать, удалять или включать в чужой коммит.
6. Authoritative DNS перенесён в Cloudflare. Почтовые MX/SPF/DKIM/DMARC нельзя
   изменять вместе с релизом Worker; их состояние проверяется отдельной задачей.
7. 12 августа 2026 года production-релиз `604e78e` перевёл быстрый сценарий на
   марку, модель, год и фото, сохранил прайс-калькулятор вторичным режимом и усилил
   страницу ремонта сколов. Read-only smoke, signed upload в закрытый B2 и приём
   тестового лида Lead Hub прошли; идемпотентный повтор не создал дубль. Доставка
   этой конкретной заявки в Telegram отдельно не подтверждалась. Follow-up
   `49f449a` добавил одноразовый повтор после временного сбоя Render и опубликован
   как Worker `7727d9ed-41f1-414a-8024-c64093312d76`.
8. Главная, калькулятор, ремонт сколов, цены, страница для юрлиц и контакты
   проверены в production при ширине 1280 и 390 px: горизонтального переполнения,
   внутренней цены `$50` и видимого текста `BYN` нет.
9. За 3–14 августа 2026 года Meta сообщает расход `$42,41`, 36 469 показов,
   охват 22 163 и 73 raw lead при raw CPL `$0,581`. Эти лиды не сопоставлены со
   статусами Lead Hub, поэтому qualified CPL, стоимость записи, CAC и ROAS пока
   неизвестны. Raw CPL нельзя использовать как единственное основание для
   автоскейлинга. Полный отчёт: [аудит Meta Ads](docs/archive/meta-ads-audit-2026-08-03-to-2026-08-14.md).
10. Отдельная защищённая форма ремонта сколов уже работает на
    `/remont-skolov/#photo-form`: фото сжимаются в браузере и загружаются в
    закрытый B2 через signed PUT. Документированной загрузки фото в Meta Instant
    Form не обнаружено; для первой кампании базовым маршрутом остаётся форма сайта,
    а Lead Ads с сообщениями рассматриваются как отдельный эксперимент.
11. Для Meta API настроены раздельные read/write credentials и `appsecret_proof`.
    Write-token подтверждён только безопасными GET-запросами: разрешены
    `ads_management` и `ads_read`, `business_management` не выдан. Repository
    default остаётся `META_WRITE_MODE=off`; предыдущий smoke выполнялся только в
    dry-run. До production write всё ещё нужны независимое human approval, durable
    audit, secret rotation/revoke drill, kill switch и согласованный live smoke на
    неактивном объекте.
12. В integration-ветке реализован и покрыт локальными тестами campaign-bundle v1 для одной
    allow-listed Website `OUTCOME_LEADS` campaign, одного ad set и 1–3 ads. Все
    delivery objects остаются `PAUSED`; external asset catalog, detached Ed25519
    approval, durable ledger, account lock и reconciliation обязательны. Контур
    default off; activation/publish/delete/upload/Instant Forms и произвольный
    targeting не поддерживаются. `npm run meta-ads:check` подтверждает 72 теста;
    installation/canary должны быть подтверждены отдельно, live Meta writes в
    рамках реализации не выполнялись.
13. Pricing evidence ремонта скола от 15 августа 2026 года истекло 15 сентября
    2026 года. Claim «от 30 BYN» нельзя переносить в новый catalog или proposal без
    повторной проверки источников и нового business-offer approval.
14. 21 сентября 2026 года локальный Instagram Graph read-only client прошёл
    identity smoke через `graph.instagram.com`; токен не выводится и не передаётся
    Ads MCP. Для webhook по-прежнему отсутствуют `META_WEBHOOK_VERIFY_TOKEN` и
    `META_ALLOWED_RECIPIENT_IDS`, а production ingest и outbound остаются off.

## Ближайшие решения

| ID | Решение | Приоритет | Состояние |
| --- | --- | --- | --- |
| `INFRA-001` | Перенести сайт с Netlify на Cloudflare Workers | P1 | Выполнено: production Worker, custom domain, static assets и server API работают |
| `DNS-001` | Перенести authoritative DNS и восстановить `www` | P1 | Выполнено: зона Cloudflare, apex и `www` резолвятся |
| `STORAGE-001` | Сравнить рабочий B2 с Cloudflare R2 и подготовить план миграции | P1 | Запланировано |
| `LEADS-001` | Переключить Telegram webhook и outbox worker полностью на Lead Hub | P1 | Выполнено |
| `KUFAR-001` | Перевести Kufar email handler на durable Lead Hub inbox | P1 | Выполнено, production smoke test 2 августа 2026 года |
| `TELEGRAM-LEADS-001` | Добавить отдельного публичного Telegram-бота для клиентов | P1 | Код и миграция `cae7eef` развёрнуты с feature flag off; production enable заблокирован `LEGAL-001` |
| `META-001` | Подключить Meta Instant Forms к durable inbox | P1 | Заблокировано `LEGAL-001`, app review и подписанным webhook |
| `META-MESSAGING-001` | Подключить Meta DM webhook к Lead Hub и отдельно согласовать auto-reply | P0 | Signed ingest интегрирован локально в `493d4dd`, production feature flag off; messaging permission, copy и canary ещё не утверждены |
| `META-CONTROL-001` | Ввести Meta Ads control plane | P1 | Plugin интегрирован локально в `991a76f`; 72/72 теста и validator проходят, repository default off; install/canary и production write отдельно не утверждены |
| `META-PHOTO-001` | Подготовить рекламный photo-flow ремонта сколов на существующую private site/B2 форму | P1 | Запланировано; нужны consent-aware measurement и mobile E2E smoke |
| `ADS-CHIP-001` | Запустить отдельный контролируемый эксперимент ремонта сколов | P1 | Заблокировано `META-PHOTO-001`, `LEGAL-001` и подтверждением оффера мастером |
| `META-IDENTITY-001` | Создать изолированные service identities для ads, publishing и lead retrieval | P1 | Ads identity готова; локальная read-only Instagram identity boundary добавлена; publishing и lead-retrieval identities не созданы |
| `META-AGENT-001` | Реализовать full-cycle Meta marketing agent по этапам | P1 | ADR-0006 принят; локальные strict catalog, detached approval, ledger/reconciliation и PAUSED materializer реализованы и протестированы; production canary, activation и publishing остаются заблокированы |
| `CONTENT-001` | Ввести контент-календарь, approval, публикацию и weekly learning | P1 | Запланировано по operations runbook |
| `LEGAL-001` | Утвердить privacy policy, consent и срок хранения PII | P1 | Политика, consent evidence и cookie controls опубликованы; остаются регламент удаления во всех копиях и проверка Реестра операторов |
| `OPS-001` | Добавить CI для проверок сайта и Lead Hub | P2 | Выполнено: GitHub Actions проверяет Cloudflare production build и Lead Hub без секретов и автодеплоя |
| `ADS-001` | Подключать рекламные конверсии только после consent и стабильного Lead Hub | P2 | Заблокировано `LEGAL-001` |

Подробный список находится в [docs/roadmap.md](docs/roadmap.md).

## Правило актуализации

После значимого production-изменения нужно:

1. обновить таблицу сервисов и ограничений;
2. при необходимости создать или обновить ADR в `docs/decisions/`;
3. отметить выполненную задачу в `docs/roadmap.md`;
4. указать проверенный commit SHA;
5. не записывать сюда секреты, внутренние цены и персональные данные клиентов.
