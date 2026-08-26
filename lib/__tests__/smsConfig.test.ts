import { describe, expect, it } from 'vitest';
import {
  MAX_SENDER_ID_CHARS,
  isSendable,
  smsConfigProblem,
  smsParts,
  toBmsRecipient,
  toGsm7,
  type SmsConfigFields,
} from '@/lib/smsConfig';
import { outboundFor } from '@/lib/deliveryMessages';
import type { DeliveryWithMerchant } from '@/lib/types';

function fields(patch: Partial<SmsConfigFields> = {}): SmsConfigFields {
  return { enabled: false, senderId: '', ...patch };
}

describe('toBmsRecipient', () => {
  it('applies the house rule for Ghanaian numbers, with no plus', () => {
    // BMS echoes numbers back as 233… in its own delivery reports, so that is what
    // it is sent. lib/phone.ts already owns "0-prefixed means +233"; the only
    // difference from the WhatsApp links is the missing '+'.
    expect(toBmsRecipient('0201234567')).toBe('233201234567');
    expect(toBmsRecipient('+233 20 123 4567')).toBe('233201234567');
    expect(toBmsRecipient('233201234567')).toBe('233201234567');
  });

  it('leaves a non-Ghanaian number in its own country code', () => {
    expect(toBmsRecipient('+15551234567')).toBe('15551234567');
  });

  it('is empty rather than wrong when there is no usable number', () => {
    // The send path treats '' as "no number on file" and reports that per message.
    // A half-formed number reaching BMS would be a paid rejection.
    expect(toBmsRecipient('')).toBe('');
    expect(toBmsRecipient('1234')).toBe('');
    expect(toBmsRecipient(null)).toBe('');
  });
});

describe('toGsm7', () => {
  it('replaces the typography that forces UCS-2', () => {
    expect(toGsm7('Osu — Adenta')).toBe('Osu - Adenta');
    expect(toGsm7('the rider’s details')).toBe("the rider's details");
    expect(toGsm7('“SOMOEXPRESS”')).toBe('"SOMOEXPRESS"');
    expect(toGsm7('Preparing…')).toBe('Preparing...');
  });

  it('leaves letters GSM-7 already covers alone', () => {
    // à ä ö ñ ü è é ç are all in the GSM-7 alphabet, so substituting them would
    // mangle a name for no saving at all.
    expect(toGsm7('Café Chalé')).toBe('Café Chalé');
  });

  it('does not mangle a name it cannot represent', () => {
    // Mangling "Zoë" into "Zo?" to save one credit is the wrong trade. The message
    // costs what it costs; the saving comes from the portal's own punctuation.
    expect(toGsm7('Zoë 陳記')).toBe('Zoë 陳記');
  });
});

describe('smsParts', () => {
  it('counts a short GSM-7 message as one part', () => {
    expect(smsParts('Short and plain')).toBe(1);
    expect(smsParts('a'.repeat(160))).toBe(1);
    expect(smsParts('a'.repeat(161))).toBe(2);
  });

  it('charges two septets for the extension characters', () => {
    // { } [ ] ~ ^ \ | and € each take two, so 80 of them fill a single part
    // exactly and the 81st spills over.
    expect(smsParts('{'.repeat(80))).toBe(1);
    expect(smsParts('{'.repeat(81))).toBe(2);
  });

  it('drops to 70 characters a part as soon as one character is not GSM-7', () => {
    // The whole point of toGsm7, and the reason it exists at all. One curly
    // apostrophe in a 160-character message doubles what it costs.
    expect(smsParts('a'.repeat(160))).toBe(1);
    expect(smsParts('a'.repeat(159) + '’')).toBe(3);
  });

  /**
   * The regression that justifies the substitution pass, measured on the message
   * it matters most for.
   *
   * BMS has no equivalent of Twilio's SmartEncoded flag, so nothing strips the
   * portal's own punctuation server-side. The recipient's "on the way" alert
   * carries one em dash, which is enough to bill the whole 310-character message
   * at UCS-2's 67 characters a part instead of GSM-7's 153: five credits instead
   * of three, on the one message that goes out for every single delivery.
   */
  it('saves two credits on the alert every delivery sends', () => {
    const record = {
      id: 'a1b2c3d4-0000-0000-0000-000000000000',
      customer: 'Obra Chop Bar',
      pickup: 'Osu',
      dropoff: 'Adenta',
      distance: 12.4,
      durationMin: 27,
      type: 'Standard',
      itemCategory: 'Food',
      recipientName: 'Ama',
      recipientPhone: '0201234567',
      riderName: 'Aba',
      riderPhone: '0209876543',
      riderModel: 'Boxer',
      riderReg: 'GT-1234',
      declaredValue: 150,
      price: 31,
      itemPayment: 'Cash on delivery',
      deliveryPaidBy: 'Customer',
      status: 'Picked up',
    } as unknown as DeliveryWithMerchant;

    const [toRecipient] = outboundFor('picked-up', record, {
      opsPhone: '0200000000',
      merchantPhone: '0201111111',
      links: { 'recipient-confirm': 'https://portal.example/d/tok' },
    });

    expect(smsParts(toRecipient.text)).toBe(5);
    expect(smsParts(toGsm7(toRecipient.text))).toBe(3);

    // And the cleaned text is genuinely GSM-7 now, not merely shorter: running the
    // substitution again changes nothing.
    const cleaned = toGsm7(toRecipient.text);
    expect(toGsm7(cleaned)).toBe(cleaned);
  });
});

describe('smsConfigProblem', () => {
  it('says nothing about a configuration nobody has filled in', () => {
    // The shipped default. An admin who never opens the SMS card should not be
    // nagged by a card that thinks it is broken.
    expect(smsConfigProblem(fields(), false)).toBeNull();
  });

  /**
   * BMS rejects an over-long sender ID at send time as a validation error — the
   * whole campaign fails and nobody is told anything. Eleven is the field width,
   * not a safety margin, so it is worth catching in the form.
   */
  it('refuses a sender ID longer than BMS allows, and says how long it is', () => {
    const tooLong = 'S'.repeat(MAX_SENDER_ID_CHARS + 1);
    const problem = smsConfigProblem(fields({ senderId: tooLong }), true);

    expect(problem).toContain(String(MAX_SENDER_ID_CHARS + 1));
    expect(problem).toContain('at most 11');
  });

  it('refuses a sender ID carriers would not route', () => {
    expect(smsConfigProblem(fields({ senderId: '233Somo' }), true)).toContain('start with a letter');
    expect(smsConfigProblem(fields({ senderId: 'Somo!' }), true)).toContain('start with a letter');
    expect(smsConfigProblem(fields({ senderId: 'SomoExpres' }), true)).toBeNull();
  });

  /**
   * `enabled` is what turns "incomplete" into a refusal, and it has to, because
   * the failure it prevents is silent: sending switched on over a half-filled row
   * means alerts that never arrive with nothing in the UI to say why. The
   * app_settings_sms_ready constraint is the copy of this rule that cannot be
   * bypassed.
   */
  it('only demands a complete configuration once sending is switched on', () => {
    const keyOnly = fields();

    expect(smsConfigProblem(keyOnly, true)).toBeNull();
    expect(smsConfigProblem({ ...keyOnly, enabled: true }, true)).toContain(
      'a message needs a name to come from'
    );
    expect(smsConfigProblem({ enabled: true, senderId: 'SomoExpres' }, false)).toContain(
      'BMS API key'
    );
  });

  it('passes a complete configuration', () => {
    const complete = fields({ enabled: true, senderId: 'SomoExpres' });

    expect(smsConfigProblem(complete, true)).toBeNull();
    expect(isSendable(complete, true)).toBe(true);
    // The same configuration with the key gone is not sendable, which is what the
    // send path checks before it posts anything to a paid API.
    expect(isSendable(complete, false)).toBe(false);
  });
});
