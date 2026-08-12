# Cloudflare Worker preview

Документ описывает изолированный preview сайта BelStekloExpert на Cloudflare
Workers. Production работает в отдельном Worker `belstekloexpert-production`, а
preview не имеет production custom domain и всегда закрыт от индексации.

## Контур

- Worker: `belstekloexpert-preview`;
- URL: `https://belstekloexpert-preview.belstekloexpert.workers.dev`;
- Astro config: `astro.config.cloudflare.mjs`;
- Wrangler source config: `wrangler.cloudflare.jsonc`;
- generated deploy config: `dist/server/wrangler.json`;
- Lead Hub: существующий Render Web Service;
- база: существующий Neon PostgreSQL;
- фото: существующий закрытый Backblaze B2 bucket.

Preview получает `X-Robots-Tag: noindex, nofollow`. Локальный `.env` отключён как
источник Cloudflare build variables и не должен попадать в `dist`.

Prerendered HTML, CSS, изображения и PDF обслуживаются как static assets без
запуска Worker. После Cloudflare-сборки скрипт создаёт в `dist/client/_headers`
host-specific правило `noindex` только для `*.workers.dev`. SSR и API проходят
через Worker, где тот же заголовок добавляет middleware. Production-домен это
правило не затрагивает.

## Сборка и публикация

```powershell
npm run build:cloudflare
npm run deploy:cloudflare:dry
npm run deploy:cloudflare
npm run check:cloudflare:preview
```

Wrangler публикует конфигурацию, сгенерированную Astro в
`dist/server/wrangler.json`. Production-конфигурация Cloudflare и legacy fallback
при этом не меняются.

## Переменные

Публичные preview-настройки находятся в `wrangler.cloudflare.jsonc`. Значения
секретов в репозиторий не добавляются.

Для отправки формы Cloudflare Worker должен иметь secret:

```text
WEB_INGEST_API_KEY
```

Его значение должно совпадать с действующим ключом web-ingest в Lead Hub. Ключ
добавляется через Cloudflare Dashboard или интерактивную команду Wrangler и не
выводится в терминал, документацию или Git.

## CORS фотографий

Для проверки фото в CORS закрытого Backblaze B2 bucket нужно временно разрешить
точный origin:

```text
https://belstekloexpert-preview.belstekloexpert.workers.dev
```

Bucket не переводится в public. Загрузка и чтение продолжают использовать
короткоживущие signed URL.

Для preview используется отдельное правило `bse-cloudflare-preview-put` только с
операцией `s3_put`. Production CORS-правило и его origins сохраняются.

## Smoke test

1. Главная страница отвечает HTTP 200.
2. Главная и prerendered content page содержат
   `X-Robots-Tag: noindex, nofollow`.
3. `/api/health/` отвечает HTTP 200 и сообщает только `database: connected`.
4. Тестовая форма создаёт один лид в Lead Hub.
5. Большое тестовое фото сжимается в браузере и загружается signed PUT.
6. Telegram получает один явно помеченный smoke-test лид и фото.
7. В логах и ответах нет секретов, signed URL и полных персональных данных.

На Render Free первый health-запрос после простоя может завершиться по timeout во
время холодного запуска. Повторная проверка выполняется после пробуждения сервиса.

29 июля 2026 года smoke test пройден с исходным JPG размером 15,5 МБ:

- браузер выполнил автоматическое сжатие;
- B2 принял signed PUT из Cloudflare preview-origin;
- Lead Hub создал синтетический тестовый лид;
- outbox доставил лид и фото в Telegram без ошибки.

30 июля 2026 года commit `669fd95` опубликован как Worker version
`c4e67557-1072-49a6-a8f9-a1eeb23ea357`. Read-only smoke подтвердил `noindex` на
главной и prerendered content page, рабочие health и lead endpoints. Параллельная
проверка на тот момент подтвердила работоспособность прежнего origin. После
завершённого cutover актуальным production является Cloudflare Worker.

## Worker metrics

30 июля 2026 года метрики отфильтрованы по активной версии `c4e67557`. После
read-only серии запросов Cloudflare зафиксировал:

- 36 Worker invocations;
- CPU Time P50/P90/P99: 0,90/3,06/4,58 ms;
- median CPU активного deployment: 0,90 ms;
- errors, exceeded CPU и exceeded memory: 0;
- memory P50/P90/P99: 16,02/16,16/25,43 MB;
- 26 static asset requests с cache hit rate 96,15%.

Статические страницы обходят Worker, поэтому эти значения относятся к SSR/API.
Preview укладывается в CPU и memory limits Free plan. Wall Time P90/P99 достигал
3/15 секунд из-за внешнего Render subrequest и не является Worker CPU. В серии из
15 health-запросов один вернул временный HTTP 503; следующие 14 и отдельная серия
5/5 вернули HTTP 200. Риск холодного старта Render остаётся предметом production-
мониторинга и должен учитываться в пользовательском поведении формы.

## Rollback

Preview никогда не принимает production-трафик, поэтому его rollback — перестать
использовать preview URL или откатить только `belstekloexpert-preview`. Production
Worker и DNS при этом не меняются. Откат production описан в профильном runbook.

Текущая последовательность production-публикации и rollback описана в
[Cloudflare production runbook](cloudflare-cutover-runbook.md).
