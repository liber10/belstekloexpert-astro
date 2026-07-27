# BelStekloExpert

Сайт и контур обработки заявок сервиса автостёкол в Минске.

Проект состоит из двух приложений в одном репозитории:

- Astro-сайт с калькулятором, контентом и серверными формами;
- Lead Hub на Fastify с PostgreSQL, Telegram-интеграцией и приватным хранением фото.

## Быстрая навигация

| Документ | Для чего нужен |
| --- | --- |
| [PROJECT_STATUS.md](PROJECT_STATUS.md) | Текущее состояние production, ограничения и ближайшие решения |
| [AGENTS.md](AGENTS.md) | Правила работы Codex и других ИИ-агентов |
| [docs/README.md](docs/README.md) | Индекс всей проектной документации |
| [docs/architecture.md](docs/architecture.md) | Архитектура, потоки данных и границы сервисов |
| [docs/roadmap.md](docs/roadmap.md) | Приоритеты и растущий backlog |
| [docs/lead-hub-runbook.md](docs/lead-hub-runbook.md) | Запуск и эксплуатация Lead Hub |
| [docs/price-update.md](docs/price-update.md) | Обновление прайса калькулятора |

## Production-контур

| Часть | Платформа | Назначение |
| --- | --- | --- |
| Сайт | Netlify | `https://belstekloexpert.by` |
| Lead Hub | Render | API заявок, health endpoints и Telegram-контур |
| База | Neon PostgreSQL | Лиды, события и outbox |
| Фото | Backblaze B2 | Закрытый bucket и короткоживущие signed URL |
| Резервный вариант | Cloudflare R2 | Кандидат для следующего инфраструктурного этапа |
| Репозиторий | GitHub | `liber10/belstekloexpert-astro` |

Актуальное состояние и известные ограничения всегда фиксируются в
[PROJECT_STATUS.md](PROJECT_STATUS.md).

## Структура

```text
.
├── src/                     # Astro-сайт
│   ├── components/          # UI и формы
│   ├── content/             # Контентные коллекции
│   ├── data/                # Контакты, цены, бренды и данные калькулятора
│   ├── layouts/             # Макеты страниц
│   ├── lib/                 # Серверные клиенты, validation и schema
│   ├── pages/               # Страницы и API routes
│   └── styles/              # Общие стили
├── apps/
│   └── lead-hub/            # Fastify + PostgreSQL + Telegram + object storage
├── public/                  # Публичные изображения, PDF, favicon и служебные файлы
├── scripts/                 # Прайсы, XLSX и генерация материалов
├── tests/                   # Тесты интеграции сайта с Lead Hub
└── docs/                    # Архитектура, эксплуатация, решения и архив
```

Astro-сайт намеренно остаётся в корне. Перемещать его в `apps/site` сейчас не нужно:
это создаст риск для существующих конфигураций Netlify и Render без практической
пользы.

## Локальный запуск

Требуется Node.js 22+.

```powershell
npm install
npm run dev
```

По умолчанию Astro доступен на `http://127.0.0.1:4321/`.

Lead Hub с локальной PostgreSQL запускается отдельно:

```powershell
docker compose -f apps/lead-hub/docker-compose.yml up -d --build
npm run lead-hub:dev
```

Подробности находятся в [runbook Lead Hub](docs/lead-hub-runbook.md).

## Проверки

Минимальный набор перед публикацией изменений сайта:

```powershell
npm run test:site
npm run build
npm run build:render
```

Для изменений Lead Hub:

```powershell
npm run lead-hub:check
```

Integration-тесты с PostgreSQL запускаются только с отдельной тестовой базой.
Production `DATABASE_URL` нельзя использовать как `TEST_DATABASE_URL`.

## Обновление прайса

```powershell
npm run prices:update -- --source .private/imports/latest.xlsx
```

Исходные прайсы, review-файлы и внутренняя стоимость работ остаются в `.private/`
или локальном окружении и не попадают в Git. Полный порядок описан в
[docs/price-update.md](docs/price-update.md).

## Секреты

Значения токенов, ключей, URL базы и signed URL запрещено:

- добавлять в Git;
- вставлять в документацию;
- выводить в отчётах и логах;
- передавать в браузерный JavaScript.

Production-секреты хранятся только в настройках соответствующей платформы.
