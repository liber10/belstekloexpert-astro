# Cloudflare production cutover

Документ описывает безопасный перенос frontend BelStekloExpert с Netlify на
Cloudflare Workers. Перенос разделён на независимые этапы: сначала Cloudflare
становится DNS-провайдером, но сайт остаётся на Netlify; затем отдельным решением
переключается origin на Worker.

Production cutover пока не утверждён. Команды публикации и изменения DNS
выполняются только после явного подтверждения владельца.

## Текущее состояние DNS

Публичная проверка 30 июля 2026 года показала:

- authoritative DNS: `u1.hoster.by` и `u2.hoster.by`;
- apex `belstekloexpert.by`: `A 75.2.60.5`, сайт обслуживает Netlify;
- TTL публичных web-записей: 600 секунд;
- `www.belstekloexpert.by` не разрешается: CNAME сформирован как относительное имя
  и получил лишний суффикс зоны;
- публичные MX, TXT и DS для apex не обнаружены.

Перед сменой nameserver нужен полный экспорт зоны из Hoster.by. Публичный DNS-запрос
не показывает все возможные служебные и почтовые записи. Адрес
`info@belstekloexpert.by` опубликован на сайте, поэтому почтовые MX, SPF, DKIM и
DMARC нужно проверить отдельно, даже если почта пока не используется.

## Подготовленный runtime

| Контур | Worker | Config | Индексация |
| --- | --- | --- | --- |
| Preview | `belstekloexpert-preview` | `wrangler.cloudflare.jsonc` | `noindex` |
| Будущий production | `belstekloexpert-production` | `wrangler.cloudflare.production.jsonc` | indexable только на custom domain |

Оба контура используют отдельные Astro config. Production Worker не должен
заменять preview Worker: это сохраняет безопасный канал проверки будущих изменений.
Секрет `WEB_INGEST_API_KEY` задаётся отдельно для каждого Worker и не хранится в
Git.

Prerendered HTML, CSS, изображения и PDF обслуживаются как static assets без
запуска Worker. Cloudflare-сборка создаёт host-specific `_headers`-правило,
которое добавляет `noindex` на `*.workers.dev`. SSR и `/api/*` проходят через
Worker, где `noindex` добавляет middleware. Custom domain остаётся indexable, а
static traffic не расходует Worker requests.

## Лимиты Cloudflare Free

Актуально по официальной документации Cloudflare на 30 июля 2026 года:

- 100 000 Worker requests в сутки, сброс в 00:00 UTC;
- 10 ms CPU на один HTTP-вызов;
- 128 MB памяти;
- 50 subrequests на один вызов;
- Worker bundle до 3 MB;
- до 20 000 static assets, размер одного файла до 25 MiB;
- request body до 100 MB на Cloudflare Free plan;
- совпавшие static assets бесплатны и не ограничены, если Worker script не вызван.

Dry run текущей сборки: около 1,5 MiB без сжатия и 280 KiB gzip, 168 assets.
Размеры укладываются в Free plan. Фото не проходит через Worker body: браузер
сжимает его и загружает напрямую в закрытый B2 по signed URL.

Главный открытый риск — 10 ms CPU для Astro SSR. Перед production cutover в
Cloudflare Dashboard нужно проверить Worker Metrics:

1. нет `exceededResources`;
2. CPU Time P50/P90/P99 просмотрены после серии запросов к основным страницам;
3. если CPU регулярно превышает лимит, публичные страницы переводятся на prerender
   либо используется Workers Paid от 5 USD в месяц.

Официальные источники:

- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/);
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/);
- [Static assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/);
- [Static asset headers](https://developers.cloudflare.com/workers/static-assets/headers/);
- [Worker metrics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/);
- [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

## Этап A: перенести только DNS

Цель этапа — сделать Cloudflare authoritative DNS, продолжая обслуживать сайт с
Netlify. Это отделяет риск nameserver migration от смены runtime.

1. Экспортировать всю DNS-зону в Hoster.by и сохранить снимок записей.
2. Исправить `www`: CNAME должен указывать на
   `comfy-profiterole-37ba97.netlify.app` как на полное имя.
3. Проверить работу apex, `www`, почты и служебных TXT у текущего провайдера.
4. Добавить `belstekloexpert.by` в Cloudflare Free, но nameserver пока не менять.
5. Сравнить auto-scan Cloudflare с экспортом Hoster.by: A, AAAA, CNAME, MX, TXT,
   CAA, SRV и DKIM-записи должны совпадать.
6. На Cloudflare оставить web-записи направленными на Netlify:
   apex `A 75.2.60.5`, `www` CNAME на Netlify site hostname.
7. Если у регистратора появился DS/DNSSEC, отключить его до смены nameserver.
8. Заменить nameserver у регистратора на назначенные Cloudflare.
9. Дождаться статуса зоны `Active` и проверить резолвинг через несколько DNS.
10. Выполнить read-only smoke test:

```powershell
npm run check:production:readonly
```

После этапа A production всё ещё работает на Netlify. Для отката nameserver можно
вернуть `u1.hoster.by` и `u2.hoster.by`, но это медленный аварийный rollback из-за
DNS-кешей.

## Этап B: подготовить production Worker

До подключения домена:

```powershell
npm run deploy:cloudflare:production:dry
npm run deploy:cloudflare:production
```

После первой публикации:

1. добавить отдельный secret `WEB_INGEST_API_KEY`;
2. разрешить точный workers.dev origin в отдельном CORS-правиле B2;
3. проверить страницы, health, форму без фото и форму с фото;
4. проверить CPU metrics и отсутствие resource errors;
5. записать проверенный commit и Worker version.

URL `*.workers.dev` получает `noindex` на static assets через сгенерированный
`_headers`, а на SSR-ответах через middleware, в том числе для
production-конфигурации.

## Этап C: переключить origin

Custom Domain требует активную Cloudflare zone. Cloudflare создаёт DNS и
сертификат автоматически; hostname с существующим CNAME сначала освобождается.

1. Зафиксировать работающий Netlify target для rollback.
2. Убедиться, что production Worker и его secret проверены.
3. Добавить к production Worker только Custom Domain `belstekloexpert.by`.
4. Для `www` создать proxied `A` на зарезервированный placeholder
   `192.0.2.0` и Cloudflare Redirect Rule `www` → apex с HTTP 308.
5. Проверить автоматический TLS certificate и redirect с `www` на apex.
6. Выполнить read-only smoke, затем одну синтетическую заявку без фото.
7. Проверить Lead Hub, PostgreSQL и Telegram.
8. Через сутки проверить ошибки, CPU и количество Worker requests.

## Быстрый rollback origin

Cloudflare остаётся authoritative DNS. Nameserver не меняется.

1. Удалить Custom Domain `belstekloexpert.by` у production Worker.
2. Отключить Redirect Rule `www` → apex.
3. Восстановить apex `A 75.2.60.5`.
4. Восстановить `www` CNAME на Netlify site hostname.
5. Проверить TLS, главную, `/api/health/` и `/api/lead/`.
6. Отправить одну синтетическую заявку без фото.
7. Зафиксировать причину rollback в `PROJECT_STATUS.md`.

Переключение origin и rollback нельзя совмещать с миграцией B2 → R2. Хранилище
фото меняется отдельной задачей `STORAGE-001`.
