/**
 * Normalizes Ethiopian phone numbers to the local 10-digit form (09XXXXXXXX / 07XXXXXXXX),
 * so "+251911223344", "251911223344", "911223344" and "0911 22 33 44" all match.
 * Anything that doesn't look Ethiopian is returned with spaces and dashes stripped.
 */
export function normalizePhone(input: string): string {
  const digits = input.replace(/[\s\-()]/g, '').replace(/^\+/, '');
  if (/^251[79]\d{8}$/.test(digits)) return '0' + digits.slice(3);
  if (/^[79]\d{8}$/.test(digits)) return '0' + digits;
  return digits;
}
