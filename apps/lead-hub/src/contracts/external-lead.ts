export type ExternalLeadSource = 'meta' | 'kufar' | 'telegram' | 'onliner';

export interface ExternalLeadInput {
  source: ExternalLeadSource;
  sourceDetail?: string;
  externalLeadId: string;
  externalEventId: string;
  name?: string;
  phone?: string;
  email?: string;
  carMake?: string;
  carModel?: string;
  carYear?: number;
  vin?: string;
  vehicleType?: string;
  serviceType?: string;
  damageType?: string;
  sensors?: string;
  heating?: string;
  adas?: string;
  district?: string;
  visitType?: string;
  preferredAt?: string;
  message?: string;
  sourceActionUrl?: string;
  sourceMetadata?: Record<string, string | number | boolean | null>;
  acquisitionCode?: string;
  telegramUserId?: string;
  telegramChatId?: string;
  telegramUsername?: string;
  consentAt?: string;
  privacyVersion?: string;
  receivedAt?: string;
}
