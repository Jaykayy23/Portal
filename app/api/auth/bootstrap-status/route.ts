import { NextResponse } from 'next/server';
import { handle } from '@/lib/http';
import { hasAnyAccount } from '@/lib/session';

// Tells the client whether to show "create admin account" or "log in".
export async function GET() {
  return handle(async () => NextResponse.json({ hasAccounts: hasAnyAccount() }));
}
