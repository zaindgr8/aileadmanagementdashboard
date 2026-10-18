import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, withSession } from '@/lib/auth/session';
import { authenticate, recordFailedAttempt, tooManyAttempts } from '@/lib/auth/users';

export const dynamic = 'force-dynamic';

// Sign in.
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';
  if (tooManyAttempts(ip)) return NextResponse.json({ error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429 });

  const body = (await req.json().catch(() => ({}))) as { username?: string; password?: string };
  const result = await authenticate(String(body.username ?? ''), String(body.password ?? ''));
  if ('error' in result) {
    if (result.status === 401) recordFailedAttempt(ip);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { user } = result;
  if (!user.modules.length && !user.platformAdmin) return NextResponse.json({ error: 'Your account has no modules enabled yet.' }, { status: 403 });
  return withSession(req, NextResponse.json({ ok: true, user }), user);
}

// Sign out.
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return res;
}
