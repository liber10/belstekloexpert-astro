import { Type, type Static } from '@sinclair/typebox';

export const TelegramPublicUpdateSchema = Type.Object({
  update_id: Type.Integer({ minimum: 0 }),
  message: Type.Optional(Type.Object({
    text: Type.Optional(Type.String({ maxLength: 4_096 })),
    chat: Type.Object({ id: Type.Integer(), type: Type.String({ maxLength: 32 }) }),
    from: Type.Optional(Type.Object({
      id: Type.Integer(),
      username: Type.Optional(Type.String({ maxLength: 64 })),
      first_name: Type.Optional(Type.String({ maxLength: 120 })),
    }, { additionalProperties: true })),
    contact: Type.Optional(Type.Object({
      phone_number: Type.String({ maxLength: 40 }),
      user_id: Type.Optional(Type.Integer()),
    }, { additionalProperties: true })),
  }, { additionalProperties: true })),
}, { additionalProperties: true });

export type TelegramPublicUpdate = Static<typeof TelegramPublicUpdateSchema>;
