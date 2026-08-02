export class InvalidPhoneError extends Error {
  constructor() {
    super('Phone must be a valid Belarusian number in E.164-compatible form.');
    this.name = 'InvalidPhoneError';
  }
}

export function normalizeBelarusPhone(value: string) {
  let digits = value.replace(/\D/g, '');

  if (digits.length === 11 && digits.startsWith('80')) {
    digits = `375${digits.slice(2)}`;
  } else if (digits.length === 10 && digits.startsWith('0')) {
    digits = `375${digits.slice(1)}`;
  } else if (digits.length === 9) {
    digits = `375${digits}`;
  }

  if (!/^375\d{9}$/.test(digits)) {
    throw new InvalidPhoneError();
  }

  return `+${digits}`;
}

export function maskPhone(value: string | null | undefined) {
  if (!value) return 'нет телефона';
  const digits = value.replace(/\D/g, '');
  if (digits.length < 4) return '[redacted]';
  return `+${digits.slice(0, 3)}…${digits.slice(-2)}`;
}
