import { NextResponse } from 'next/server';
import { handle } from '@/lib/http';
import { clearSessionCookie } from '@/lib/session';

export async function POST() {
  return handle(async () => {
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  });
}
