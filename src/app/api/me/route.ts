import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth/current';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await currentUser();
  return user ? NextResponse.json(user) : NextResponse.json({ error: 'Please sign in' }, { status: 401 });
}
