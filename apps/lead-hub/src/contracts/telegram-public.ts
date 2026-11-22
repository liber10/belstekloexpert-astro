import { Type, type Static } from '@sinclair/typebox';

export const TelegramPublicUpdateSchema = Type.Object({
  update_id: Type.Integer({ minimum: 0 }),
  message: Type.Optional(Type.Object({
    date: Type.Optional(Type.Integer({ minimum: 0 })),
    text: Type.Optional(Type.String({ maxLength: 4_096 })),
    chat: Type.Object({ id: Type.Integer(), type: Type.String({ maxLength: 32 }) }),
    from: Type.Optional(Type.Object({
      id: Type.Integer(),
      is_bot: Type.Optional(Type.Boolean()),
      username: Type.Optional(Type.String({ maxLength: 64 })),
      first_name: Type.Optional(Type.String({ maxLength: 120 })),
    }, { additionalProperties: true })),
    contact: Type.Optional(Type.Object({
      phone_number: Type.String({ maxLength: 40 }),
      user_id: Type.Optional(Type.Integer()),
    }, { additionalProperties: true })),
    photo: Type.Optional(Type.Array(Type.Object({
      file_id: Type.String({ minLength: 1, maxLength: 512 }),
      file_size: Type.Optional(Type.Integer({ minimum: 1 })),
    }, { additionalProperties: true }), { minItems: 1, maxItems: 16 })),
  }, { additionalProperties: true })),
}, { additionalProperties: true });

export type TelegramPublicUpdate = Static<typeof TelegramPublicUpdateSchema>;
