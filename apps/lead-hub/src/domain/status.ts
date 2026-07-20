export const leadStatuses = [
  'new',
  'contacted',
  'qualified',
  'quote_sent',
  'booked',
  'arrived',
  'won',
  'lost',
  'spam',
  'duplicate',
] as const;

export type LeadStatus = (typeof leadStatuses)[number];

export const statusLabels: Record<LeadStatus, string> = {
  new: 'Новый',
  contacted: 'Связались',
  qualified: 'Квалифицирован',
  quote_sent: 'Цена озвучена',
  booked: 'Записан',
  arrived: 'Доехал / выезд',
  won: 'Выполнено',
  lost: 'Потерян',
  spam: 'Спам',
  duplicate: 'Дубль',
};

export function isLeadStatus(value: string): value is LeadStatus {
  return leadStatuses.includes(value as LeadStatus);
}
