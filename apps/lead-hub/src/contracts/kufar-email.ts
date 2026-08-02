import { Type, type Static } from '@sinclair/typebox';

const OptionalText = (maxLength: number) => Type.Optional(Type.String({ minLength: 1, maxLength }));

export const KufarEmailEventSchema = Type.Object(
  {
    externalMessageId: Type.String({ minLength: 1, maxLength: 255 }),
    subject: OptionalText(500),
    customerMessage: Type.String({ minLength: 1, maxLength: 3_500 }),
    conversationUrl: OptionalText(2_048),
    conversationId: OptionalText(255),
    customerName: OptionalText(120),
    itemTitle: OptionalText(500),
    itemUrl: OptionalText(2_048),
    receivedAt: OptionalText(64),
  },
  { additionalProperties: false },
);

export type KufarEmailEvent = Static<typeof KufarEmailEventSchema>;
