/** Strips formatting and applies Ghana's country code to local 0-prefixed numbers. */
export function normalizePhone(raw: string | undefined | null): string {
  if (!raw) return '';
  let digits = String(raw).replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('0')) digits = '233' + digits.slice(1);
  return digits;
}

/**
 * True if the number could plausibly be dialled.
 *
 * Deliberately loose: it checks the digit count after normalisation, not the
 * network prefix. A rider's number that MTN issues next year should not be
 * rejected by a list this app has no business maintaining — and the cost of a
 * wrong number is a rider who has to call ops, not a corrupted record. The
 * range covers a local 0-prefixed Ghana number through the longest E.164 one.
 */
export function isValidPhone(raw: string | undefined | null): boolean {
  const digits = normalizePhone(raw);
  return digits.length >= 9 && digits.length <= 15;
}

/** wa.me deep link that pre-fills a message. Null when there's no usable number. */
export function waLink(phone: string, message: string): string | null {
  const p = normalizePhone(phone);
  return p ? `https://wa.me/${p}?text=${encodeURIComponent(message)}` : null;
}

/** sms: deep link that pre-fills a message. Null when there's no usable number. */
export function smsLink(phone: string, message: string): string | null {
  const p = normalizePhone(phone);
  return p ? `sms:+${p}?body=${encodeURIComponent(message)}` : null;
}
