import { describe, expect, it } from 'vitest';
import {
  describeSender,
  isSendable,
  senderKind,
  toE164,
  twilioConfigProblem,
  type TwilioConfigFields,
} from '@/lib/twilioConfig';

/** Well-formed SIDs: the two-letter prefix and 32 hex characters. */
const ACCOUNT = 'AC' + '0'.repeat(32);
const API_KEY = 'SK' + 'a'.repeat(32);
const SERVICE = 'MG' + 'f'.repeat(32);

function fields(patch: Partial<TwilioConfigFields> = {}): TwilioConfigFields {
  return {
    enabled: false,
    accountSid: '',
    apiKeySid: '',
    fromNumber: '',
    messagingServiceSid: '',
    ...patch,
  };
}

describe('toE164', () => {
  it('applies the house rule for Ghanaian numbers and puts the plus back', () => {
    // lib/phone.ts already owns "0-prefixed means +233". Twilio wants the '+',
    // which the rest of the portal's links do not — so the difference between
    // what WhatsApp is handed and what Twilio is handed lives here and nowhere
    // else.
    expect(toE164('0201234567')).toBe('+233201234567');
    expect(toE164('+233 20 123 4567')).toBe('+233201234567');
    expect(toE164('233201234567')).toBe('+233201234567');
  });

  it('leaves a non-Ghanaian number alone', () => {
    expect(toE164('+15551234567')).toBe('+15551234567');
  });

  it('is empty rather than wrong when there is no usable number', () => {
    // The send path treats '' as "no number on file" and reports that per
    // message. A half-formed number reaching Twilio would be a paid failure.
    expect(toE164('')).toBe('');
    expect(toE164('1234')).toBe('');
    expect(toE164(null)).toBe('');
  });
});

describe('senderKind', () => {
  it('lets a Messaging Service win over a number', () => {
    // Twilio's own recommendation, and the reason the two fields are not
    // mutually exclusive in the form: an admin can leave the number in place
    // while moving to a service.
    expect(
      senderKind({ fromNumber: '+233201234567', messagingServiceSid: SERVICE })
    ).toBe('messaging-service');
  });

  it('tells a number from a sender name', () => {
    expect(senderKind({ fromNumber: '+233201234567', messagingServiceSid: '' })).toBe('number');
    expect(senderKind({ fromNumber: 'SOMOEXPRESS', messagingServiceSid: '' })).toBe('alphanumeric');
    expect(senderKind({ fromNumber: '   ', messagingServiceSid: '' })).toBe('none');
  });

  it('says out loud that a sender name cannot be replied to', () => {
    // Ops need to know this before they pick one, not after a rider texts back
    // into a void.
    expect(describeSender({ fromNumber: 'SOMOEXPRESS', messagingServiceSid: '' })).toContain(
      'nobody can reply'
    );
  });
});

describe('twilioConfigProblem', () => {
  it('says nothing about a configuration nobody has filled in', () => {
    // The shipped default. An admin who never opens the SMS card should not be
    // nagged by a card that thinks it is broken.
    expect(twilioConfigProblem(fields(), false)).toBeNull();
  });

  /**
   * The regression this guard exists for, and the reason the SID shapes are
   * checked at all. AccountSid:AuthToken is a valid Twilio credential pair, so an
   * Account SID pasted into the API Key SID box authenticates and then fails at
   * the moment of sending with Twilio's own "authentication error" — which sends
   * whoever is debugging it to look at the secret rather than at the box above it.
   */
  it('catches an Account SID pasted into the API Key SID box, by name', () => {
    const problem = twilioConfigProblem(
      fields({ accountSid: ACCOUNT, apiKeySid: ACCOUNT }),
      true
    );
    expect(problem).toContain('That is the Account SID, not an API Key SID');
  });

  it('complains about a malformed SID even while sending is off', () => {
    // Shape is wrong whether or not it is in use, and saying so at the moment it
    // is typed is the only cheap time to say it.
    expect(twilioConfigProblem(fields({ accountSid: 'AC-nope' }), false)).toContain(
      'does not look like an Account SID'
    );
    expect(twilioConfigProblem(fields({ messagingServiceSid: 'MG123' }), false)).toContain(
      'Messaging Service SID'
    );
  });

  it('rejects a sender name Twilio would not accept', () => {
    // Over 11 characters, so not a sender ID — and not digits, so not a number
    // either. Left to Twilio this is a paid round trip to find out.
    expect(twilioConfigProblem(fields({ fromNumber: 'SOMOEXPRESS GH' }), false)).toContain(
      'not a usable sender'
    );
    expect(twilioConfigProblem(fields({ fromNumber: 'SOMOEXPRESS' }), false)).toBeNull();
  });

  /**
   * `enabled` is what turns "incomplete" into a refusal, and it has to, because
   * the failure it prevents is silent: sending switched on over a half-filled row
   * means alerts that never arrive with nothing in the UI to say why. The
   * app_settings_twilio_ready constraint is the copy of this rule that cannot be
   * bypassed.
   */
  it('only demands a complete configuration once sending is switched on', () => {
    const half = fields({ accountSid: ACCOUNT });

    expect(twilioConfigProblem(half, true)).toBeNull();
    expect(twilioConfigProblem({ ...half, enabled: true }, true)).toContain(
      'a message needs somebody to come from'
    );
  });

  it('names the secret after whichever credential pair is in use', () => {
    // "Add your Auth Token" over a form with an API Key SID in it would be
    // pointing at a box that is not there.
    const withKey = fields({ enabled: true, accountSid: ACCOUNT, apiKeySid: API_KEY });
    expect(twilioConfigProblem(withKey, false)).toContain('API Key Secret');

    const withoutKey = fields({ enabled: true, accountSid: ACCOUNT });
    expect(twilioConfigProblem(withoutKey, false)).toContain('Auth Token');
  });

  it('passes a complete configuration', () => {
    const complete = fields({
      enabled: true,
      accountSid: ACCOUNT,
      apiKeySid: API_KEY,
      fromNumber: '+233201234567',
    });

    expect(twilioConfigProblem(complete, true)).toBeNull();
    expect(isSendable(complete, true)).toBe(true);
    // The same configuration with the secret gone is not sendable, which is what
    // the send path checks before it posts anything to a paid API.
    expect(isSendable(complete, false)).toBe(false);
  });
});
