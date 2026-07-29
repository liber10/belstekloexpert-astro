# ADR-0003: Cloudflare Workers и R2 как кандидат миграции

Статус: принят для preview; production cutover не утверждён.

Дата: 29 июля 2026 года.

## Контекст

Netlify останавливал новые production-деплои после исчерпания build-кредитов.
Backblaze B2 уже работает и протестирован, но владелец проекта также зарегистрировал
Cloudflare и получил доступ к R2.

R2 поддерживает S3-compatible API, поэтому текущий object-storage adapter можно
адаптировать через environment settings без изменения формы загрузки.

## Решение

Для совместимого с Astro SSR preview использовать Cloudflare Workers:

- отдельный Worker `belstekloexpert-preview`;
- адрес `belstekloexpert-preview.belstekloexpert.workers.dev`;
- отдельную Cloudflare-конфигурацию без изменения основного Netlify adapter;
- заголовок `X-Robots-Tag: noindex, nofollow` на preview;
- Render и Neon оставить для Lead Hub;
- Backblaze B2 оставить production-хранилищем до решения `STORAGE-001`.

Cloudflare R2 остаётся отдельным кандидатом для приватных фото:

- текущий S3-compatible object-storage adapter можно перенастроить через окружение.

Не переключать production только ради унификации. Сначала подготовить preview,
совместимость SSR/API routes, CORS, signed uploads, custom domain и rollback.

## Критерии принятия

1. Все страницы, redirect, sitemap и server endpoints работают в preview.
2. Большое фото проходит сжатие, signed PUT и Telegram delivery.
3. Существующие `photo_refs` остаются доступными либо объекты мигрированы.
4. DNS можно вернуть на предыдущий target без потери заявок.
5. Зафиксированы реальные бесплатные лимиты и прогноз объёма.

## Проверенный результат

29 июля 2026 года Worker preview опубликован. Проверены:

- HTTP 200 главной страницы;
- `X-Robots-Tag: noindex, nofollow`;
- `/api/health/` и соединение Lead Hub с PostgreSQL;
- ожидаемый HTTP 405 для GET `/api/lead/` с pipeline `hub`.

До production cutover остаются:

- добавить `WEB_INGEST_API_KEY` как Cloudflare secret;
- разрешить preview-origin в CORS Backblaze B2;
- выполнить smoke test формы, сжатия фото, signed upload и Telegram;
- проверить custom domain и документированный rollback.

Netlify остаётся production-хостингом, DNS не изменён. Backblaze B2 остаётся
production-хранилищем. Задачи отслеживаются как `INFRA-001` и `STORAGE-001`.
