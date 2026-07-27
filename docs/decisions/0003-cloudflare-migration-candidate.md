# ADR-0003: Cloudflare Pages/Workers и R2 как кандидат миграции

Статус: предложен.

Дата: 27 июля 2026 года.

## Контекст

Netlify останавливал новые production-деплои после исчерпания build-кредитов.
Backblaze B2 уже работает и протестирован, но владелец проекта также зарегистрировал
Cloudflare и получил доступ к R2.

R2 поддерживает S3-compatible API, поэтому текущий object-storage adapter можно
адаптировать через environment settings без изменения формы загрузки.

## Предлагаемое решение

На следующем инфраструктурном этапе проверить единый контур:

- Cloudflare Pages или Workers для сайта;
- Cloudflare R2 для приватных фото;
- Render и Neon оставить для Lead Hub до отдельного решения.

Не переключать production только ради унификации. Сначала подготовить preview,
совместимость SSR/API routes, CORS, signed uploads, custom domain и rollback.

## Критерии принятия

1. Все страницы, redirect, sitemap и server endpoints работают в preview.
2. Большое фото проходит сжатие, signed PUT и Telegram delivery.
3. Существующие `photo_refs` остаются доступными либо объекты мигрированы.
4. DNS можно вернуть на предыдущий target без потери заявок.
5. Зафиксированы реальные бесплатные лимиты и прогноз объёма.

## Текущее решение

Backblaze B2 остаётся production-хранилищем. Cloudflare хранится как подготовленный
кандидат, а задача отслеживается как `INFRA-001` и `STORAGE-001`.
