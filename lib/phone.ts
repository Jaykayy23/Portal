/** Strips formatting and applies Ghana's country code to local 0-prefixed numbers. */
export function normalizePhone(raw: string | undefined | null): string {
  if (!raw) return '';
  let digits = String(raw).replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('0')) digits = '233' + digits.slice(1);
  return digits;
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
