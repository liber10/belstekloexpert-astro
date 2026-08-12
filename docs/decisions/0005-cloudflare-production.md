# ADR-0005: Cloudflare Workers как production frontend

Статус: принят и введён в эксплуатацию.

Дата: 12 августа 2026 года. Фактическое переключение выполнено 2 августа 2026 года.

## Контекст

Cloudflare preview подтвердил совместимость Astro SSR, server-side API, загрузки
фото через signed PUT и доставки заявок в Lead Hub. Netlify ранее ограничивал
production-деплои build-кредитами. К 12 августа authoritative DNS, apex, `www` и
production Worker уже работали через Cloudflare, хотя документация продолжала
описывать прежний origin.

## Решение

- Production frontend обслуживает Worker `belstekloexpert-production`.
- Custom domain: `https://belstekloexpert.by`.
- Authoritative DNS: Cloudflare.
- Preview остаётся отдельным Worker `belstekloexpert-preview` с `noindex`.
- Render остаётся владельцем Lead Hub, Neon — PostgreSQL, Backblaze B2 — приватных
  фотографий.
- Cloudflare R2 не включается в этот перенос и рассматривается отдельно.
- Netlify и standalone Node конфигурации сохраняются только как fallback.

## Релиз

Обязательная последовательность:

1. `npm run check` и `npm run test:site`.
2. `npm run build:cloudflare:production`.
3. `npm run deploy:cloudflare:production:dry`.
4. Commit и push проверенного состояния.
5. `npm run deploy:cloudflare:production`.
6. `npm run check:production:readonly`.
7. При изменении форм — одна явно помеченная синтетическая заявка.

## Rollback

Первый способ отката — `wrangler rollback` на предыдущую рабочую Worker version.
DNS и object storage при этом не меняются. Возврат на legacy Netlify origin требует
отдельного решения владельца и используется только если Worker rollback невозможен.

## Последствия

Cloudflare является единственным production frontend-контуром. Документы и отчёты
не должны называть Netlify текущим хостингом. Релиз сайта и релиз Render Lead Hub
остаются независимыми.
