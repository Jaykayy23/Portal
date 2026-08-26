import { NextResponse } from 'next/server';
import { badRequest, handle, requireUser, readJson } from '@/lib/http';
import { enforceRateLimit } from '@/lib/rateLimit';
import { TwilioError, sendTestSms, twilioStatus, verifyTwilioCredentials } from '@/lib/twilio';
import { isValidPhone } from '@/lib/phone';

/**
 * Is automated SMS available?
 *
 * The Notify modal asks on open, so it can offer a send button or explain why it
 * cannot rather than showing a control that fails when pressed. Answered for
 * every role that can send an alert, because all three of them open that modal.
 *
 * The response is two fields and neither is a credential: whether sending works,
 * and a sentence for when it does not. Nothing in lib/twilio.ts can return more
 * than that — see TwilioStatus.
 */
export async function GET() {
  return handle(async () => {
    await requireUser('admin', 'ops', 'merchant');
    return NextResponse.json(await twilioStatus());
  });
}

interface TestBody {
  /** Omit to check the credentials only. Supply a number to also text it. */
  to?: string;
}

/**
 * A real send would tell an admin the same thing at twice the cost, so the check
 * is capped low. It exists to stop a stuck retry loop, not to ration a button
 * somebody presses twice.
 */
const TEST_LIMIT = { limit: 6, windowSeconds: 300 };

const TEST_BODY =
  'SomoExpress test message. If you are reading this, the portal can send SMS through Twilio.';

/**
 * Proves the saved configuration works — first without spending anything, then,
 * if a number is given, for real.
 *
 * Two steps in one call on purpose. "The credentials are wrong" and "the
 * credentials are fine but this sender cannot reach this recipient" are the two
 * failures an admin has to tell apart, and they are indistinguishable from a
 * message that simply never arrives. Checking the account first means a failure
 * here always names which of the two it was.
 *
 * The credentials tested are the *saved* ones. Nothing is accepted from the
 * request body except the destination number, so testing never becomes a second
 * path that carries a secret over the wire — an admin saves, then tests.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser('admin');
    await enforceRateLimit('sms-test', user.id, TEST_LIMIT);

    const { to } = await readJson<TestBody>(req);

    const credentials = await verifyTwilioCredentials();
    if (!credentials.ok) badRequest(credentials.detail);

    if (to === undefined || String(to).trim() === '') {
      return NextResponse.json({ detail: credentials.detail, sent: false });
    }

    const number = String(to).trim();
    if (!isValidPhone(number)) {
      badRequest('That does not look like a phone number the portal can dial.');
    }

    try {
      const result = await sendTestSms(number, TEST_BODY);
      if (!result.ok) badRequest(`${credentials.detail} But the test message failed: ${result.error}`);

      return NextResponse.json({
        detail: `${credentials.detail} Test message accepted by Twilio (${result.segments} SMS part${result.segments === 1 ? '' : 's'}).`,
        sent: true,
        sid: result.sid,
      });
    } catch (e) {
      // Only thrown when sending is off entirely, which verifyTwilioCredentials
      // above has already ruled out — so reaching here means the switch was
      // turned off between the two calls.
      if (e instanceof TwilioError) badRequest(e.message);
      throw e;
    }
  });
}
