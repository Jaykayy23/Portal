import { NextResponse } from 'next/server';
import { handle } from '@/lib/http';
import { signOut } from '@/lib/session';

export async function POST() {
  return handle(async () => {
    await signOut();
    return NextResponse.json({ ok: true });
  });
}
