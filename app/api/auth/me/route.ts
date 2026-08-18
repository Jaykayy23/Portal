import { NextResponse } from 'next/server';
import { handle, requireUser } from '@/lib/http';

export async function GET() {
  return handle(async () => NextResponse.json({ user: await requireUser() }));
}
