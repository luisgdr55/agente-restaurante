import { validateName } from '../agent/name-validator';

describe('validateName', () => {
  test('valid names pass', () => {
    expect(validateName('Luis').valid).toBe(true);
    expect(validateName('María José').valid).toBe(true);
    expect(validateName('Ángel').valid).toBe(true);
    expect(validateName('  juan  ').valid).toBe(true);
  });

  test('capitalizes name correctly', () => {
    const r = validateName('juan carlos');
    expect(r.valid && r.name).toBe('Juan Carlos');
  });

  test('too short fails with TOO_SHORT', () => {
    const r = validateName('A');
    expect(r).toMatchObject({ valid: false, reason: 'TOO_SHORT' });
  });

  test('empty string fails with TOO_SHORT', () => {
    const r = validateName('');
    expect(r).toMatchObject({ valid: false, reason: 'TOO_SHORT' });
  });

  test('only numbers fails with ONLY_NUMBERS', () => {
    const r = validateName('123456');
    expect(r).toMatchObject({ valid: false, reason: 'ONLY_NUMBERS' });
  });

  test('phone number fails with ONLY_NUMBERS', () => {
    const r = validateName('04141234567');
    expect(r).toMatchObject({ valid: false, reason: 'ONLY_NUMBERS' });
  });

  test('special characters fail with INVALID_FORMAT', () => {
    const r = validateName('@username');
    expect(r).toMatchObject({ valid: false, reason: 'INVALID_FORMAT' });
  });

  test('emojis fail with INVALID_FORMAT', () => {
    const r = validateName('🍔 Burger');
    expect(r).toMatchObject({ valid: false, reason: 'INVALID_FORMAT' });
  });
});
