import { Type, type Static } from '@sinclair/typebox';

const OptionalText = (maxLength: number) => Type.Optional(Type.String({ minLength: 1, maxLength }));

export const AttributionSchema = Type.Optional(
  Type.Object(
    {
      utmSource: OptionalText(255),
      utmMedium: OptionalText(255),
      utmCampaign: OptionalText(255),
      utmContent: OptionalText(255),
      utmTerm: OptionalText(255),
      gclid: OptionalText(255),
      gbraid: OptionalText(255),
      wbraid: OptionalText(255),
      yclid: OptionalText(255),
      fbclid: OptionalText(255),
      ymClientId: OptionalText(255),
      gaClientId: OptionalText(255),
      landingUrl: OptionalText(2_048),
      referrer: OptionalText(2_048),
    },
    { additionalProperties: false },
  ),
);

export const WebLeadBodySchema = Type.Object(
  {
    sourceDetail: OptionalText(160),
    externalLeadId: OptionalText(255),
    name: OptionalText(120),
    phone: Type.String({ minLength: 7, maxLength: 40 }),
    email: OptionalText(254),
    carMake: OptionalText(100),
    carModel: OptionalText(160),
    carYear: Type.Optional(Type.Integer({ minimum: 1886, maximum: 2100 })),
    vin: Type.Optional(
      Type.String({ minLength: 17, maxLength: 17, pattern: '^[A-HJ-NPR-Z0-9]{17}$' }),
    ),
    vehicleType: OptionalText(80),
    serviceType: OptionalText(120),
    damageType: OptionalText(120),
    sensors: OptionalText(500),
    heating: OptionalText(500),
    adas: OptionalText(500),
    district: OptionalText(120),
    visitType: OptionalText(80),
    preferredAt: OptionalText(64),
    message: OptionalText(4_000),
    photoRefs: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 2_048 }), { maxItems: 5 }),
    ),
    attribution: AttributionSchema,
    consentAt: OptionalText(64),
    privacyVersion: OptionalText(80),
  },
  { additionalProperties: false },
);

export type WebLeadBody = Static<typeof WebLeadBodySchema>;

export interface LeadResponse {
  ok: true;
  leadId: string;
  publicId: string;
  status: string;
  deduplicated: boolean;
}
