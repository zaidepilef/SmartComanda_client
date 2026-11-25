/** Prefijo fijo de celular chileno; el cliente escribe solo los 8 dígitos restantes. */
export const MOBILE_PREFIX = '+569';
export const MOBILE_DIGITS = 8;

/**
 * Deja solo dígitos y como máximo los 8 que van después de +569.
 * Si se pega el número completo (+56912345678 o 912345678) se quita el prefijo.
 */
export function sanitizeMobileDigits(value: string): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  const full = digits.match(/^(?:569|9)(\d{8})$/);
  return full ? full[1] : digits.slice(0, MOBILE_DIGITS);
}

export function isCompleteMobile(digits: string): boolean {
  return /^\d{8}$/.test(digits);
}

export function toCanonicalMobile(digits: string): string {
  return `${MOBILE_PREFIX}${digits}`;
}

/** Recupera los 8 dígitos de un teléfono guardado (+569XXXXXXXX, 569…, 9…). */
export function mobileDigitsOf(phone: string): string {
  const digits = String(phone ?? '').replace(/\D/g, '');
  const match = digits.match(/^(?:569|9)(\d{8})$/);
  return match ? match[1] : '';
}
