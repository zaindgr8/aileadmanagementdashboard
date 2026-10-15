import { NextResponse, type NextRequest } from 'next/server';
import { cookieOptions, createSession, SESSION_COOKIE } from '@/lib/auth/session';
import { authenticate, recordFailedAttempt, tooManyAttempts } from '@/lib/auth/users';

export const dynamic = 'force-dynamic';

// Sign in.
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';
  if (tooManyAttempts(ip)) return NextResponse.json({ error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429 });

  const body = (await req.json().catch(() => ({}))) as { username?: string; password?: string };
  const user = await authenticate(String(body.username ?? ''), String(body.password ?? ''));
  if (!user) {
    recordFailedAttempt(ip);
    return NextResponse.json({ error: 'Incorrect username or password' }, { status: 401 });
  }
  if (!user.modules.length) return NextResponse.json({ error: 'Your account has no modules enabled yet.' }, { status: 403 });

  // Behind a TLS-terminating proxy the request itself arrives over http.
  const proto = (req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '')).split(',')[0].trim();
  const res = NextResponse.json({ ok: true, user });
  res.cookies.set(SESSION_COOKIE, createSession(user), cookieOptions(process.env.NODE_ENV === 'production' && proto === 'https'));
  return res;
}

// Sign out.
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return res;
}
