import { describe, expect, it } from 'vitest';
import { InvalidPhoneError, maskPhone, normalizeBelarusPhone } from '../../src/domain/phone.js';

describe('normalizeBelarusPhone', () => {
  it.each([
    ['+375 29 111-11-11', '+375291111111'],
    ['375291111111', '+375291111111'],
    ['8 029 111-11-11', '+375291111111'],
    ['029 111-11-11', '+375291111111'],
    ['29 111-11-11', '+375291111111'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeBelarusPhone(input)).toBe(expected);
  });

  it('rejects non-Belarusian and malformed numbers', () => {
    expect(() => normalizeBelarusPhone('+48 123 456 789')).toThrow(InvalidPhoneError);
    expect(() => normalizeBelarusPhone('123')).toThrow(InvalidPhoneError);
  });
});

describe('maskPhone', () => {
  it('does not expose a full phone', () => {
    expect(maskPhone('+375291111111')).toBe('+375…11');
  });
});
