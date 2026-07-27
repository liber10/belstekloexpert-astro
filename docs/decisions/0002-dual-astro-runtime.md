# ADR-0002: отдельные Astro-конфигурации Netlify и Node

Статус: принят.

Дата: 27 июля 2026 года.

## Контекст

Основной сайт использует Netlify adapter. Для дополнительного запуска Astro на
Render или другом Node-хостинге требуется standalone Node adapter.

Замена основного adapter сломала бы существующий deployment.

## Решение

- `astro.config.mjs` остаётся основной Netlify-конфигурацией;
- `astro.config.render.mjs` остаётся отдельной Node-конфигурацией;
- `npm run build` проверяет Netlify;
- `npm run build:render` проверяет standalone Node;
- обе сборки обязательны при изменении Astro config или runtime-зависимостей.

## Последствия

Проект сохраняет рабочий Netlify deployment и готовность к альтернативному
Node-runtime. Цена решения: две конфигурации нужно проверять на расхождение.
