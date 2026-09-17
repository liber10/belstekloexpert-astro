# ADR-0004: локальный Meta Ads control plane и поэтапная автоматизация

Статус: принят для локального этапа; production write не утверждён.

Дата: 12 августа 2026 года.

## Контекст

В Meta запущена Instant Form-реклама BelStekloExpert. Исходный reference MCP
предоставлял только восемь GET-инструментов и не был оформлен как Codex-плагин.
Для проекта нужен единый контур, который связывает рекламные расходы с качеством
лида в Lead Hub и в будущем способен выполнять ограниченные действия, а не только
давать рекомендации.

Прямой универсальный доступ модели к Graph API неприемлем: ошибочный запрос может
изменить бюджет или остановить рекламу, а Meta payload содержит идентификаторы и
персональные данные. Текущие статусы лидов пока не дают достоверного сигнала
qualified/booked/won для оптимизации.

## Решение

В репозитории используется локальный плагин `plugins/belsteklo-meta-ads`:

- MCP работает через фиксированный Meta Graph host и версионированный API;
- read и write credentials разделены и остаются вне Git;
- рекламный аккаунт ограничен серверным allowlist;
- raw Meta IDs заменяются временными `entity_ref` в tool results;
- изменения поддерживают только pause, resume и bounded daily-budget update;
- каждое изменение проходит `prepare -> short-lived diff -> apply`;
- apply проверяет TTL, approval code, cooldown и актуальность состояния;
- после POST выполняется read-after-write; неизвестный результат блокирует retry;
- JSONL-аудит не содержит токенов, raw IDs или lead PII;
- delete, billing, roles, audiences, targeting и публикация отсутствуют.

Плагин не подключается напрямую к PostgreSQL. Lead Hub остаётся источником истины
для лидов и этапов. Будущая связь выполняется через scoped internal API и отдельные
таблицы control plane, а не через существующий Telegram outbox.

## Режимы

1. `observe`: чтение структуры, Insights и change history.
2. `plan`: расчёт решения и dry-run diff.
3. `guarded apply`: явное одобрение, policy и read-after-write.
4. `bounded autopilot`: только заранее утверждённые reversible actions.

`bounded autopilot` на первом этапе может автоматически выполнить emergency pause
или уменьшить бюджет. Он не может возобновлять доставку, увеличивать бюджет,
менять targeting или публиковать креативы.

## Связь с Lead Hub

Перед оптимизацией по качеству необходимо:

1. принять подписанный Meta Lead Ads webhook в durable inbox;
2. дедуплицировать лид по provider reference;
3. нормализовать campaign/ad set/ad/form attribution;
4. фиксировать qualified, booked, won, revenue и lost reason;
5. передавать CRM stages через Conversions API сначала в dry-run;
6. агрегировать метрики без выдачи PII плагину.

Meta write token не должен храниться в Astro-сайте или использовать ingest-ключ
форм. Для always-on automation нужен отдельный worker/control API с audit и kill
switch; локальный MCP остаётся operator interface.

## Условия production write

- закрыты privacy/consent, retention и проверка трансграничной передачи;
- Meta App, permissions, asset roles и token rotation проверены;
- read-only сверка Insights совпадает с Ads Manager;
- есть backup/rollback и alert по ошибкам write;
- smoke выполнен на согласованном неактивном объекте;
- владелец зафиксировал бюджетные caps и допустимые операции;
- для autopilot есть минимум данных и надёжный сигнал качества Lead Hub.

До выполнения условий `META_WRITE_MODE=off` или `dry-run`.

## Реализация на 15 августа 2026 года

Этап `observe` подтверждён на одном allow-listed аккаунте: чтение структуры,
Insights и breakdowns работает, локальные тесты и plugin validator пройдены.
Отдельный write-token проверен безопасными GET-запросами: выданы только
`ads_management` и `ads_read`, `business_management` отсутствует;
`appsecret_proof` включён. Плагин остаётся в `META_WRITE_MODE=dry-run` с лимитом
дневного бюджета 1000 minor units, максимальным изменением 20%, TTL 15 минут и
cooldown 6 часов. На завершившейся кампании выполнен
`prepare -> dry-run apply -> audit` smoke; повторное чтение подтвердило, что объект
Meta не изменился. В плагин добавлена read-only диагностика
`meta_validate_write_access`, версия `0.1.0+codex.20260815043214` установлена в
Codex. Исправлена несовместимость Insights field list с Graph API v25.0.

Это состояние не расширяет решение на создание кампаний, targeting, публикацию
рекламы или органического контента. Full-cycle контур и разделение principals
определены отдельным [ADR-0006](0006-meta-marketing-agent.md).
