# Cloudflare production runbook

Актуализировано: 12 августа 2026 года.

Документ описывает публикацию и откат production frontend BelStekloExpert на
Cloudflare Workers. Исторический cutover с Netlify завершён; повторно переносить
DNS при обычном релизе не нужно.

## Текущий контур

| Область | Значение |
| --- | --- |
| Production Worker | `belstekloexpert-production` |
| Custom domain | `https://belstekloexpert.by` |
| Authoritative DNS | Cloudflare |
| Preview Worker | `belstekloexpert-preview` |
| Production config | `astro.config.cloudflare.production.mjs` |
| Wrangler source config | `wrangler.cloudflare.production.jsonc` |
| Generated deploy config | `dist/server/wrangler.json` |
| Lead Hub | Render Web Service |
| Database | Neon PostgreSQL |
| Photos | закрытый Backblaze B2 bucket |

Apex и `www` резолвятся через Cloudflare. Preview и production являются разными
Workers. Preview получает `noindex`; custom domain production остаётся indexable.

## Границы релиза

- Сайт и Render Lead Hub публикуются независимо.
- Обычный релиз сайта не меняет DNS, custom domain, Neon или B2.
- `WEB_INGEST_API_KEY` хранится только как Cloudflare Worker secret.
- Публичные production-настройки находятся в
  `wrangler.cloudflare.production.jsonc`; секретов там быть не должно.
- Локальный `.env` исключён из Cloudflare production build.
- Миграция B2 в R2 выполняется только отдельной задачей `STORAGE-001`.

## Перед публикацией

1. Проверить рабочее дерево и отделить посторонние изменения.
2. Запустить:

```powershell
npm run check
npm run test:site
npm run build:cloudflare:production
npm run deploy:cloudflare:production:dry
```

3. Проверить, что dry-run использует:
   - Worker name `belstekloexpert-production`;
   - `DEPLOY_ENV=production`;
   - `LEAD_DELIVERY_MODE=hub`;
   - binding `SESSION` и static assets;
   - secret `WEB_INGEST_API_KEY`, не раскрывая его значение.
4. Проверить итоговый diff и отсутствие секретов, внутренних цен и приватных
   исходных прайсов.
5. Закоммитить и отправить проверенное состояние в `main`.

## Публикация

```powershell
npm run deploy:cloudflare:production
```

После deploy записать новую Worker version и SHA коммита. Git push сам по себе не
считается production-деплоем.

## Read-only smoke

```powershell
npm run check:production:readonly
```

Проверка должна подтвердить:

1. главная, калькулятор и контентная страница отвечают HTTP 200;
2. production-домен не получает `X-Robots-Tag: noindex`;
3. `/api/health/` возвращает безопасный ответ о доступности базы;
4. GET `/api/lead/` возвращает ожидаемый 405 и pipeline `hub`;
5. sitemap и robots доступны;
6. в ответах нет секретов и технических деталей подключения.

Render Free может просыпаться дольше обычного. Один временный 503 на health не
считается успешной проверкой: после пробуждения сервис должен стабильно отвечать.

## Smoke формы

При изменении формы или API после read-only smoke отправляется одна явно помеченная
синтетическая заявка. Для фото-потока дополнительно проверяются:

1. браузерное сжатие;
2. signed PUT в закрытый B2;
3. сохранение `photo_ref` в Lead Hub;
4. единственная карточка и фото в Telegram;
5. отсутствие дубля при повторе того же `submission_id`.

Тест не должен содержать реальные персональные данные клиента.

## Метрики после релиза

Проверить Cloudflare Worker metrics:

- errors и `exceededResources`;
- CPU Time P50/P90/P99;
- количество Worker invocations;
- static asset cache hit rate;
- время ответа `/api/health/` и формы с учётом Render cold start.

Static assets должны обслуживаться без запуска Worker там, где это допускает
маршрутизация Astro/Cloudflare.

## Быстрый rollback

Первый способ отката — вернуть предыдущую рабочую Worker version:

```powershell
npx wrangler deployments list --name belstekloexpert-production \
  --config wrangler.cloudflare.production.jsonc
npx wrangler rollback <previous-version-id> \
  --name belstekloexpert-production \
  --config wrangler.cloudflare.production.jsonc
```

После rollback повторить read-only smoke и одну синтетическую заявку, если сбой
касался форм.

DNS и object storage при таком откате не меняются. Возврат на legacy Netlify origin
допускается только отдельным решением владельца, если rollback Worker невозможен.
Нельзя одновременно откатывать Worker и мигрировать B2/R2.

## Legacy fallback

`astro.config.mjs` и Netlify adapter сохранены в репозитории как аварийный fallback.
Они не являются текущим production-путём и не должны использоваться в отчётах как
подтверждение Cloudflare-релиза.
