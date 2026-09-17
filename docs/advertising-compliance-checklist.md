# Чек-лист рекламы

## Оффер и креатив

- [ ] Рекламодатель указан как ООО «БелСтеклоЭксперт», УНП 193845742.
- [ ] Цена, скидка, срок, гарантия и наличие подтверждаются до публикации.
- [ ] Нет недоказуемых «№ 1», «лучший», ложных сравнений и скрытых условий.
- [ ] Фото, логотипы, музыка, отзывы и товарные знаки используются законно; для
      before/after и клиентских материалов есть release.
- [ ] AI-generated или существенно отредактированный материал отмечен во внутреннем
      provenance и не искажает результат услуги.

## Фото и персональные данные

- [ ] В Lead Ads есть ссылка на действующую `/privacy/`.
- [ ] Трансграничная передача Meta проверена и имеет основание.
- [ ] Согласие на рекламную рассылку отдельное, добровольное и не предустановлено.
- [ ] Аналитические/рекламные скрипты не запускаются до выбора пользователя.
- [ ] UTM/campaign/form IDs сохраняются только в утверждённом составе и сроке.
- [ ] Выбранный photo-flow реально поддерживается на FB/IG mobile и прошёл E2E
      smoke; недокументированный Instant Form upload не предполагается.
- [ ] Фото используется только для предварительной оценки; retention/deletion
      определены для Meta, Lead Hub, B2, Telegram и резервных копий.
- [ ] Инструкция просит не загружать лица, документы, регистрационные номера и
      другую лишнюю PII; EXIF удаляется там, где фото становится content asset.

## Доступ и автоматизация

- [ ] System User имеет роль Employee и только asset-specific tasks; нет Business
      Admin, billing, finance и role management.
- [ ] Ads, content publishing, lead retrieval и CAPI используют отдельные tokens.
- [ ] Tokens находятся в secret store; проверены expiry, rotation, revoke и
      `appsecret_proof`; webhook проверяет подпись raw body.
- [ ] Есть allowlist account/Page/IG/form/dataset/domain и global kill switch.
- [ ] Новая campaign/ad set/ad сначала создаётся `PAUSED`; generic Graph write,
      delete/archive и unknown fields запрещены.
- [ ] Approval хранит actor, exact spec hash, policy version и expiry вне MCP.

## Публикация и контроль

- [ ] Copy, creative, targeting, budget, CTA, URL, UTM и schedule прошли human
      approval.
- [ ] Resume, budget increase, новый targeting и первая публикация не выполняются
      автоматически.
- [ ] Выполняются idempotency, read-after-write и reconciliation unknown POST;
      журнал не содержит tokens, PII, photo refs или signed URL.
- [ ] Primary KPI — qualified/booked/won, а не raw CPL.
- [ ] После публикации выполнены form/attribution smoke, проверка комментариев и
      контроль через 1 час, 24 часа и 72 часа.
- [ ] Проверена применимость рекламного сбора и налогового учёта по материалам МАРТ/МНС.

Официальные ориентиры: [МАРТ](https://www.mart.gov.by/activity/regulirovanie-reklamnoy-deyatelnosti/) и [МНС](https://nalog.gov.by/entrepreneurs/taxes/taxes_paid_by_entrepreneurs/ad_tax/).

