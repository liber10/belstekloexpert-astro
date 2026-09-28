# Instagram Messaging MVP — эксплуатация

Дата реализации: 22 сентября 2026 года. Код развёрнут на Render 27 сентября
2026 года из commit `15b77b7`. Ingress включён. 28 сентября владелец показал
автоответ в ранее существовавшей переписке; outbound аварийно выключен
(`INSTAGRAM_MESSAGING_ENABLED=false`). Приложение Meta опубликовано, callback и
подписка `messages` сохранены. Фактическая отправка наблюдалась в Direct, но
безопасность условия «новый диалог» не подтверждена.
Ads, content publishing и другие outbound-каналы не входят в MVP.

## A. Что готово

Используется существующий GET/POST `/api/v1/webhooks/meta`, не второй ingress.

```text
Instagram DM
 -> HMAC по raw body + recipient allow-list + фильтр echo/self/deletion
 -> integration_inbox: UNIQUE(source, external_event_id)
 -> InboxProcessor
 -> lead + human Telegram-card job (transaction 1)
 -> lead_events: DM + first-reply decision + Instagram outbox (transaction 2)
 -> InstagramOutboxProcessor -> graph.instagram.com/<version>/<account>/messages
 -> sent + provider message ID + audit
    OR retry -> dead + Telegram escalation job (одна транзакция)
```

Crash между транзакциями не теряет сообщение: durable inbox повторяет обработку,
получает тот же лид и завершает вторую транзакцию. Instagram не вызывается до
commit сообщения/outbox. Telegram delivery не является источником истины.

Каждый DM сохраняется в `lead_events` (`source=instagram_inbound`); входящий
envelope хранится нормализованным в `integration_inbox`. Лид — один на пару
business account/sender. Другой текст следующего DM больше не вызывает hash
conflict. Решение первого ответа защищено блокировкой строки лида и уникальным
ключом события. Единственное задание: `instagram:first:<lead UUID>`.

`message.mid` дедуплицируется на ingress и при записи сообщения. Длинные mid не
обрезаются: ключ хешируется, оригинал остаётся в приватном событии. Replay,
последующие DM и параллельные workers не создают второй ответ.

Важно: существующая реализация трактует «первый» как первый DM этой пары,
сохранённый в Lead Hub. Она **не проверяет историю Instagram-переписки** и не
знает о прежних ручных ответах менеджера. Cutoff по timestamp входящего DM
этого не исправляет. До добавления fail-closed проверки истории/ручной работы
и canary-теста outbound не включать. При повторном включении отдельно разобрать
накопленные pending/retry задания Instagram outbox; не удалять их молча.

Лид не переводится из `new`; человеческий `firstResponseAt` не заполняется
автоответом. Telegram-карточка содержит номер Instagram-лида. История сообщений
остаётся в Lead Hub и native Instagram Inbox. Типы вложений сохраняются, provider
URL — нет. Скачивание/пересылка фото не входит в MVP; менеджер смотрит их в Direct.

## B. Flow и недостающие условия для первого реального ответа

Используется **Instagram API with Instagram Login**, Instagram professional
**user access token**, фиксированный `graph.instagram.com`.
Не Facebook Login/Page token и не Ads system-user token.

Read-only проверка 21 сентября подтвердила соответствие токена
`belstekloexpert` и наличие `user_id`; поля `id` и `user_id` различаются.
Это не проверка messaging scopes. Запрос `/me/permissions` вернул 400:
он не подтверждает ни выдачу, ни отсутствие messaging permission.
27 сентября read-only `GET /v25.0/<IG user_id>/conversations` с текущим
Instagram token вернул HTTP 200. Это подтверждает доступность endpoint чтения,
но не доказывает доставку webhook, право отправки или доступность реальных
клиентов, пока приложение не опубликовано и не пройден необходимый App Review.

Минимум: `instagram_business_basic` + `instagram_business_manage_messages`.
Для этого MVP не нужны `ads_management`, `ads_read`, `business_management`,
публикации или управление комментариями.
Источники: [Meta: Instagram Login](https://www.postman.com/meta/instagram/folder/1z5vxzu/instagram-api-with-instagram-login),
[Meta: Send API](https://www.postman.com/meta/instagram/folder/uxudqu0/send-api),
[Meta: текстовый ответ](https://www.postman.com/meta/instagram/request/1rgmhuk/text-message).

До production остаются: подтверждённые granted scopes и срок токена,
соответствие account ID/recipient webhook, правильный signing app secret,
callback и account subscription, доступность приложения для нужных пользователей,
постоянная работа Render worker, согласование трёх текстов и rollout cutoff.
Повторный login нужен только при недостаточных scopes/недействительном токене.

## C. Точные действия в Meta Dashboard

Не выполнять без отдельного подтверждения rollout.

1. В существующем приложении: **Use cases → Instagram → API setup with Instagram
   Login**, аккаунт `belstekloexpert`. Не создавать второе приложение/ingress.
2. Permissions/features: проверить `instagram_business_basic` и
   `instagram_business_manage_messages`, затем фактически предоставленные токену
   scopes. При необходимости Generate token и новое согласие Instagram выполняет
   владелец. Токен вставляется только в Render Environment — не в чат/скриншот/Git.
3. Сверить `META_INSTAGRAM_ACCOUNT_ID` с `user_id` Instagram Login и recipient
   реального подписанного тестового webhook. `/me.id`, IG app ID, Facebook Page
   ID и Ads account ID не взаимозаменяемы. Не подставлять старый ID наугад.
4. В настройках сообщений профессионального Instagram проверить разрешение
   доступа подключённых инструментов к сообщениям, если переключатель показан.
5. **После подтверждённого деплоя** с ingress on / outbound off: callback
   `<LEAD_HUB_PUBLIC_URL>/api/v1/webhooks/meta`, Verify token = то же значение,
   что `META_WEBHOOK_VERIFY_TOKEN` в Render. Затем Verify and save.
   При `META_INGEST_ENABLED=false` route отсутствует: сначала работающий ingress,
   затем verification, а не наоборот.
6. Подписать Instagram/нужный аккаунт на `messages`. Проверить subscription
   приложения и подключение аккаунта: одного callback URL недостаточно.
   Код сам `subscribed_apps` не вызывает. Referral-поля необязательны для общего
   ответа; отдельные referral-события без DM пока не объединяются с перепиской.
7. Для тестового режима — принятые роли/согласия тестовых principal. Для реальных
   клиентов проверить требования Dashboard к режиму приложения и уровню доступа.
   Если нужны App Review/Advanced Access, тестовые роли не заменяют эту проверку.

Login/2FA, согласие на scopes, бизнес-проверка/App Review и утверждение текстов —
действия владельца. Verify token можно сгенерировать локально, ID сверить
read-only. Заполнение Meta/Render — отдельное согласование. Новых Ads-прав не надо.

## D. Render Environment

Настраивается **Lead Hub service**, не Astro Worker/Ads MCP. Windows environment
сам в Render не переносится. Значения секретов/ID не публиковать.

| Переменная | Назначение / начальное значение |
| --- | --- |
| `META_INGEST_ENABLED` | `true` только после согласованного deploy ingress |
| `META_WEBHOOK_VERIFY_TOKEN` | Случайная строка ≥16 символов; одинаковая в Meta/Render |
| `META_APP_SECRET` | Секрет приложения, подписывающего Instagram Login webhook; кандидат — **Instagram API → Настройка API для входа в Instagram → Секрет приложения Instagram**. Точный секрет подтвердить фактической подписью тестового POST. Не подставлять прежний Facebook/Ads App Secret без проверки; не access token |
| `META_ALLOWED_RECIPIENT_IDS` | Проверенный business Instagram recipient; при необходимости список через запятую |
| `META_INSTAGRAM_ACCESS_TOKEN` | Instagram Login user token с basic/manage_messages |
| `INSTAGRAM_MESSAGING_ENABLED` | **`false`** до подтверждения реальных отправок |
| `META_INSTAGRAM_ACCOUNT_ID` | Проверенный Instagram `user_id`, обязательно в allow-list |
| `META_INSTAGRAM_GRAPH_VERSION` | `v25.0`, закреплённая версия, не latest |
| `INSTAGRAM_REPLY_START_AT` | Согласованное UTC-время ISO 8601: `YYYY-MM-DDTHH:mm:ss.sssZ` |
| `INSTAGRAM_REPLY_GENERAL_TEXT` | Согласованный общий ответ, 1–1000 символов |
| `INSTAGRAM_REPLY_REPLACEMENT_TEXT` | Согласованный ответ по замене, 1–1000 символов |
| `INSTAGRAM_REPLY_CHIP_REPAIR_TEXT` | Согласованный ответ по сколу, 1–1000 символов |
| `INSTAGRAM_AD_SCENARIOS_JSON` | Default `{}`: приватный JSON ad ID → `replacement` / `chip_repair` |
| `TELEGRAM_ENABLED` | Для включённого messaging требуется `true` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET` | Действующие настройки рабочего чата; не публичного бота |
| `LEAD_HUB_PUBLIC_URL` | HTTPS URL существующего Lead Hub |
| `DATABASE_URL`, `WEB_INGEST_API_KEY` | Действующие PostgreSQL и защищённая диагностика; не заменять |
| `OUTBOX_MAX_ATTEMPTS` | Общий retry limit, default `8` |
| `OUTBOX_DELIVERY_TIMEOUT_MS` | Default `15000` |
| `OUTBOX_PROCESSING_TIMEOUT_MS` | Default `300000`; больше delivery timeout + 5000 |

`META_WRITE_MODE=off` не меняется. Это Ads-ограничитель; у Instagram отправителя
отдельный выключатель. Входящий webhook не зависит от access token.

Предложения текстов (**не включены по умолчанию, требуют согласования**):

- Общий: «Здравствуйте! Спасибо за обращение в БелСтеклоЭксперт. Подскажите,
  пожалуйста, нужна замена стекла или ремонт скола? Если удобно, пришлите фото.»
- Замена: «Здравствуйте! Для подбора стекла пришлите, пожалуйста, марку, модель и
  год автомобиля, а также фото стекла. Специалист проверит варианты.»
- Скол: «Здравствуйте! Пришлите, пожалуйста, фото повреждения стекла: крупным
  планом и общий вид. Специалист оценит, возможен ли ремонт.»

Классификация только по известному `ad_id` в `message.referral`/`referral`
с `source=ADS`. Неизвестный ID, отдельное referral-событие без DM или инструкции
клиента → общий ответ. Ads API не вызывается; цены/обещания не выдумываются.

## E. План rollout и smoke test

1. Локальные lint/typecheck/unit/build и integration tests на отдельной PostgreSQL.
2. Согласовать ID, права, тексты, cutoff и надёжную работу Render worker. Free
   service может засыпать: для предсказуемого polling нужен постоянно работающий
   service. Проверить фактический тариф/поведение перед запуском; автоматически
   тариф не менять. [Ограничения Render Free](https://render.com/docs/free).
3. Выполнено 27 сентября: деплой **`15b77b7`** вручную из точного SHA.
   Dashboard: `Deploy succeeded | Live`; `/health/ready`: HTTP 200, revision
   соответствует SHA, PostgreSQL ready, Telegram worker active, Instagram worker
   inactive. `INSTAGRAM_MESSAGING_ENABLED=false`; `META_INGEST_ENABLED` не задан.
   Новые таблицы/миграции для MVP не потребовались. Render автоматически отключил
   Auto-Deploy для этого сервиса при выборе конкретного commit.
   В Render сохранены **без redeploy** account ID/recipient allow-list, Graph
   version, три предложенных текста и `META_INGEST_ENABLED=false`. Это только
   staged-конфигурация: приложение ещё работает с прежним окружением. При
   последующем изменении env не выбирать деплой `main` по умолчанию; повторно
   указать точный проверенный commit `15b77b7` и сверить SHA в `/health/ready`.
   Позднее 27 сентября, после подтверждения владельца, в Render добавлен
   `META_WEBHOOK_VERIFY_TOKEN` и включён `META_INGEST_ENABLED=true`; повторный
   deploy того же SHA стал Live. `/health/ready` вернул HTTP 200 и ready database.
   Приложение Meta опубликовано, callback сохранён, поле `messages` и аккаунт
   `belstekloexpert` подписаны. Встроенный тест Meta отправил подписанное
   фиктивное событие: endpoint ответил HTTP 200, `eventCount=0` из-за чужого
   тестового recipient. Это подтверждает маршрут и HMAC, но не создание лида.
   Позже логи показали реальные принятые сообщения (`eventCount=1`), владелец
   подтвердил Telegram-карточку после тестового DM. Это подтверждает приём и
   сохранение лида перед человеческой доставкой. Все три текста ответа
   утверждены владельцем. `INSTAGRAM_MESSAGING_ENABLED=false`; исходящая
   отправка ещё не проверена. Для canary нужен новый собеседник: решение
   `disabled` для уже созданного тестового лида не пересматривается.
   После отдельного подтверждения владельца `INSTAGRAM_MESSAGING_ENABLED=true`
   и `INSTAGRAM_REPLY_START_AT=2026-09-27T13:58:00.000Z` сохранены в Render;
   повторный deploy точного SHA `15b77b7` стал Live. `/health/ready`: HTTP 200,
   Instagram worker active, PostgreSQL ready. Read-only агрегаты БД за день:
   5 обработанных Meta inbox-событий, 5 сохранённых DM, 2 лида `new`; оба ранних
   решения имеют `skipped=disabled`. После cutoff на момент проверки не было
   нового Instagram outbox job или решения первого ответа. Не считать
   фактическую отправку проверенной до появления `sent` и подтверждения в Direct.
   После проверки текста в Render три `INSTAGRAM_REPLY_*_TEXT` приведены
   дословно к вариантам, утверждённым владельцем, и повторно развёрнут тот же
   SHA `15b77b7`. Все три значения сверены после сохранения; health HTTP 200,
   Instagram worker active. Cutoff и остальные переменные не менялись.
4. Выполнено: Meta settings сохранены; реальный тестовый DM принят, сохранён и
   отображён в Telegram-карточке. Для этого лида первое решение `disabled`
   остаётся неизменным.
5. У владельца не было второго тестового аккаунта. Он отдельно подтвердил
   включение для всех **новых** DM без canary-отправки; эта остаточная
   неопределённость должна быть закрыта первым фактическим сообщением.
6. Проверить первый ответ: `sent` и provider message ID в приватной БД, лид new,
   отсутствие повторного ответа на webhook replay. Outage воспроизводить
   mocks/staging, не повреждать рабочий токен.
7. После успешного smoke обновить PROJECT_STATUS подтверждённой доставкой.
   До этого статус функции — «включена, первая отправка не проверена».

## Retry и диагностика

До HTTP фиксируется `sending` и attempt. Известный временный Graph rejection:
backoff с Retry-After; исчерпание attempts/окна → dead и одна Telegram escalation
job. Постоянные ошибки прав сразу dead; бессмысленно повторять их без изменения
доступа нельзя.

Timeout, разрыв связи, HTTP 5xx/неполный success, crash во время sending, сбой
commit после успешного Meta send — **unknown outcome**. Meta мог отправить DM:
автоматического resend нет, нужен человек в Direct. Без provider idempotency
нельзя обещать end-to-end exactly-once. Поздний результат сохраняется как
`instagram_late_send_result`, но не отменяет dead-letter и не запускает resend.

Локальное окно: 24 часа минус 60 секунд от исходного DM; retry его не продлевает.
Старые сообщения до cutoff и ненадёжный timestamp не получают автоответ.
Первый ответ — **один на сохранённый диалог**, не на каждый DM/день. Новый cutoff
также проверяется перед отправкой старого queued job. Ручного resend endpoint нет.

`GET /api/v1/integrations/meta/events/<externalEventId>`, Bearer
`WEB_INGEST_API_KEY`: inbox status/attempts, messagePersisted, delivery states.
Нет клиентского текста, токена, recipient или provider message ID. Для длинного
mid используется нормализованный ключ приватного inbox. Request logs не содержат
query string с verify token. Не публиковать диагностические URL/ключи.

`/health/ready`: worker flags, общие backlog/dead counts; это не проверка scopes
или реальной доставки. Оператор контролирует instagram_dead, зависшие sending,
Telegram dead и возраст очереди. Если Telegram недоступен, alert остаётся
retry/dead в outbox; гарантировать уведомление через сломанный Telegram нельзя.
Лид и audit при этом сохранены.

## Тесты и rollback

```powershell
npm run lead-hub:check
# TEST_DATABASE_URL — отдельная localhost PostgreSQL, имя заканчивается _test.
# Не использовать production DATABASE_URL!
npm run test:integration --workspace @belstekloexpert/lead-hub
```

Integration tests очищают тестовые таблицы; Meta/Telegram заменены mocks.
Guard отвергает remote host, имя без _test и совпадение с DATABASE_URL.
Suites последовательны. Есть проверки replay, конкуренции, сохранения каждого
DM, rollback message/outbox, сбоя commit после send, retry/dead/escalation,
unknown outcome, позднего результата, выключенного режима и окна ответа.

Kill switch: `INSTAGRAM_MESSAGING_ENABLED=false` + согласованный restart.
**Ingress оставить включённым**: лиды продолжают сохраняться. Уже начатый HTTP
может завершиться до остановки; неизвестные результаты сверять с Direct.
PostgreSQL inbox/outbox/lead_events не очищать.

28 сентября 2026 года kill switch применён с разрешения владельца через Render
Save and deploy. Проверка `/health/ready`: `ok=true`, `database=ready`,
`telegram_worker_active=true`, `instagram_worker_active=false`, revision
`15b77b791825086fa59983d5544f24be56c615c2`. Причина — автоответ на DM
в уже активной переписке, где менеджер ранее вручную согласовал запись.

Нельзя без подготовки откатиться на старую сборку, где Telegram worker выбирает
все destinations: он может забрать Instagram pending/retry jobs. Для такого
rollback требуется отдельно согласованный scoped quarantine этих заданий,
остановка новых producers и сохранение sending для ручной сверки. Безопаснее
оставить новую сборку с outbound off. Повторное включение — отдельное approval,
review backlog и новый cutoff.

## Отдельный статус: «снова не срабатывает бот»

Локально missing outbound устранён кодом и тестами. **Реальный бот пока не
объявлен исправленным**: необходим разрешённый production end-to-end smoke.
Нет inbox → Meta delivery/HMAC/allow-list; inbox retry/dead → persistence/worker;
inbox done + Instagram pending/retry/dead → outbound. Sent подтверждает принятие
Meta API, а не прочтение клиентом.
