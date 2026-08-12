# Карта информационных ресурсов

| Ресурс | Владелец/роль | Данные | Доступ и защита | Статус Реестра |
| --- | --- | --- | --- | --- |
| `belstekloexpert.by` / Cloudflare Worker | ООО «БелСтеклоЭксперт», сбор заявок | формы, attribution | HTTPS, server-side API, secrets platform-side | проверить |
| Lead Hub Render | обработка лидов | заявка, статусы, consent evidence | bearer auth, webhook secrets, redacted logs | проверить |
| Neon PostgreSQL | источник истины | лиды, события, сессии | закрытая строка подключения, роли БД | проверить |
| Backblaze B2 | фото | приватные изображения | private bucket, signed URL | проверить |
| Telegram | уведомления/public bot | карточки лидов, user/chat IDs | отдельные токены и webhook secrets | проверить |
| Gmail/Apps Script | Kufar adapter | письма Kufar, URL диалога | Google account и script properties | проверить |
| Аналитика | статистика | события, UTM, browser IDs | только после consent | проверить |

Для каждого ресурса до регистрации/обновления сведений нужно утвердить сроки, категории субъектов, трансграничные передачи, уполномоченных лиц и ответственных пользователей.

