/**
 * Validación de nombre sin LLM — regex + lógica simple.
 */
import { REGEX_NAME, REGEX_ONLY_NUMBERS } from '../config/constants';

export type NameValidationResult =
  | { valid: true; name: string }
  | { valid: false; reason: 'TOO_SHORT' | 'ONLY_NUMBERS' | 'INVALID_FORMAT' };

export function validateName(input: string): NameValidationResult {
  const trimmed = input.trim();

  if (trimmed.length < 2) {
    return { valid: false, reason: 'TOO_SHORT' };
  }

  if (REGEX_ONLY_NUMBERS.test(trimmed)) {
    return { valid: false, reason: 'ONLY_NUMBERS' };
  }

  if (!REGEX_NAME.test(trimmed)) {
    return { valid: false, reason: 'INVALID_FORMAT' };
  }

  // Capitalizar primera letra de cada palabra
  const name = trimmed
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

  return { valid: true, name };
}
