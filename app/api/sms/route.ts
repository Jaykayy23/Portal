import { NextResponse } from 'next/server';
import { badRequest, handle, requireUser, readJson } from '@/lib/http';
import { enforceRateLimit } from '@/lib/rateLimit';
import { SmsError, sendTestSms, smsStatus, verifySmsCredentials } from '@/lib/sms';
import { isValidPhone } from '@/lib/phone';

/**
 * Is automated SMS available?
 *
 * The Notify modal asks on open, so it can offer a send button or explain why it
 * cannot rather than showing a control that fails when pressed. Answered for
 * every role that can send an alert, because all three of them open that modal.
 *
 * The response is two fields and neither is a credential: whether sending works,
 * and a sentence for when it does not. Nothing in lib/sms.ts can return more than
 * that — see SmsStatus.
 */
export async function GET() {
  return handle(async () => {
    await requireUser('admin', 'ops', 'merchant');
    return NextResponse.json(await smsStatus());
  });
}

interface TestBody {
  /** Omit to check the credentials only. Supply a number to also text it. */
  to?: string;
}

/**
 * The credential check is free, but the optional test send spends a credit, so
 * the whole endpoint is capped low. It exists to stop a stuck retry loop, not to
 * ration a button somebody presses twice.
 */
const TEST_LIMIT = { limit: 6, windowSeconds: 300 };

const TEST_BODY =
  'SomoExpress test message. If you are reading this, the portal can send SMS through BMS.';

/**
 * Proves the saved configuration works — first without spending anything, then,
 * if a number is given, for real.
 *
 * Two steps in one call on purpose. There are three independent ways for this to
 * be broken and from the outside they look identical, as a message that never
 * arrives: a wrong API key, an empty credit balance, and a sender ID BMS has not
 * approved. verifySmsCredentials() separates all three without sending anything,
 * so a failure here names which one it was instead of leaving an admin to guess.
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

    const credentials = await verifySmsCredentials();
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
      if (!result.ok) {
        badRequest(`${credentials.detail} But the test message failed: ${result.error}`);
      }

      const spent = `${result.parts} credit${result.parts === 1 ? '' : 's'} used`;
      const left = result.creditLeft >= 0 ? `, ${result.creditLeft} left` : '';

      return NextResponse.json({
        detail: `${credentials.detail} Test message accepted — ${spent}${left}.`,
        sent: true,
        campaignId: result.campaignId,
      });
    } catch (e) {
      // Only thrown when sending is off entirely, which verifySmsCredentials
      // above has already ruled out — so reaching here means the switch was
      // turned off between the two calls.
      if (e instanceof SmsError) badRequest(e.message);
      throw e;
    }
  });
}
