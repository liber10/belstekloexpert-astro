# Cloudflare Worker preview

Документ описывает изолированный preview сайта BelStekloExpert на Cloudflare
Workers. Production-сайт продолжает работать на Netlify, а DNS
`belstekloexpert.by` не переключён.

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
`dist/server/wrangler.json`. Основной `astro.config.mjs` и Netlify adapter при этом
не меняются.

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

## Rollback

Пока Worker не привязан к production-домену, rollback не требует изменения DNS:
preview перестают использовать, а Netlify продолжает обслуживать production.

После будущего custom-domain cutover rollback должен включать возврат DNS на
предыдущий Netlify target, проверку `/api/health/` и контрольную заявку без фото.
Сам cutover требует отдельного решения владельца проекта.

Полная последовательность DNS migration, production Worker и rollback описана в
[Cloudflare production cutover](cloudflare-cutover-runbook.md).
