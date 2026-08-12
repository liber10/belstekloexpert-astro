# Инструкция для ИИ-агентов

## Контекст

BelStekloExpert состоит из Astro-сайта в корне репозитория и отдельного Lead Hub в
`apps/lead-hub`. Перед изменениями прочитайте:

1. `README.md`;
2. `PROJECT_STATUS.md`;
3. `docs/README.md`;
4. профильный документ из `docs/`.

## Архитектурные границы

- Production-сайт собирается через `astro.config.cloudflare.production.mjs` и
  `wrangler.cloudflare.production.jsonc` в Worker `belstekloexpert-production`.
- `astro.config.cloudflare.mjs` и `wrangler.cloudflare.jsonc` принадлежат отдельному
  preview Worker и не заменяют production-конфигурацию.
- `astro.config.mjs` с `@astrojs/netlify` и `astro.config.render.mjs` с Node adapter
  сохраняются только как legacy/rollback и standalone fallback. Не подменяйте ими
  Cloudflare production.
- Astro-сайт остаётся в корне. Не переносите его в `apps/` без отдельного
  архитектурного решения.
- Lead Hub находится только в `apps/lead-hub` и владеет PostgreSQL, статусами,
  outbox, Telegram webhook и object-storage adapter.
- PostgreSQL является источником истины для принятых лидов.
- Фотографии должны оставаться приватными. Для браузера и Telegram используются
  короткоживущие signed URL.
- `/api/lead/` является совместимым публичным входом форм сайта.
- Контакты, реквизиты и режим работы должны иметь один основной источник в
  `src/data/`; ручные копии нужно синхронизировать осознанно.

## Безопасность

- Никогда не показывайте и не коммитьте значения `.env`, `DATABASE_URL`, bot token,
  chat ID, API keys, credentials object storage и signed URL.
- Не читайте локальный `.env` без прямой необходимости для конкретной проверки.
- Не добавляйте production-секреты в тесты, fixtures, Markdown или сообщения Git.
- Не логируйте полный телефон, VIN и другие персональные данные.
- Для smoke tests используйте явно помеченные фиктивные данные.
- Не используйте production database как `TEST_DATABASE_URL`.
- Bucket с фотографиями должен оставаться закрытым.

## Работа с Git

- Рабочее дерево может быть грязным. Не отменяйте и не включайте в коммит изменения,
  не относящиеся к текущей задаче.
- `main` соответствует production-направлению проекта.
- Имена веток: `feat/<scope>`, `fix/<scope>`, `docs/<scope>`, `chore/<scope>`.
- Коммит должен решать одну понятную задачу.
- Не делайте force push и destructive reset без прямого запроса владельца.

## Команды

Сайт:

```powershell
npm run check
npm run test:site
npm run build:cloudflare:production
npm run deploy:cloudflare:production:dry
```

Lead Hub:

```powershell
npm run lead-hub:check
```

Обновление прайса:

```powershell
npm run prices:update -- --source .private/imports/latest.xlsx
```

## Минимальные проверки

| Область изменения | Обязательные проверки |
| --- | --- |
| Контент, стили, компоненты | `npm run check`, `npm run build:cloudflare:production` |
| Формы и API сайта | `npm run test:site`, `npm run build:cloudflare:production`, production dry-run |
| Astro config или зависимости | Cloudflare production build и dry-run; fallback-сборки при изменении общих runtime-зависимостей |
| Lead Hub | `npm run lead-hub:check` |
| Прайс | импорт, `npm run build`, ручная проверка калькулятора |
| Фото | prepare, signed PUT, lead submission, Telegram smoke test |

Для пользовательских изменений интерфейса дополнительно проверяйте desktop и mobile.

## Деплой

- Не считайте локальную сборку опубликованной.
- Проверяйте фактический commit и статус платформы после каждого production-деплоя.
- Cloudflare Worker и Render Lead Hub публикуются независимо.
- Не меняйте custom domain, DNS, production Worker и object storage одним релизом.
- Netlify-конфигурация остаётся только аварийным fallback и не считается текущим
  production-контуром.
- Переключение object storage требует совместимости старых `photo_refs` или
  контролируемой миграции объектов.
- После production smoke test обновляйте `PROJECT_STATUS.md`.

## Документация

- Текущее состояние хранится в `PROJECT_STATUS.md`.
- План и backlog хранятся в `docs/roadmap.md`.
- Эксплуатационные процедуры хранятся в `docs/*-runbook.md` или `docs/operations/`.
- Значимое техническое решение оформляется отдельным ADR в `docs/decisions/`.
- Устаревший документ перемещается в `docs/archive/` и явно помечается как
  исторический. Его нельзя использовать как источник текущего состояния.

## Формат завершения задачи

Финальный отчёт должен кратко содержать:

1. результат;
2. изменённые файлы;
3. выполненные проверки;
4. состояние Git и SHA, если был коммит;
5. состояние деплоя, если он выполнялся;
6. оставшиеся риски или следующий конкретный шаг.
