import { unstable_rethrow } from 'next/navigation';
import { NextResponse, type NextRequest } from 'next/server';
import { readSession, SESSION_COOKIE } from '@/lib/auth/session';
import { WorkspaceError } from '@/lib/tenant/context';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const json = (data: unknown, init?: ResponseInit) =>
  NextResponse.json(data, { ...init, headers: { 'Cache-Control': 'no-store', ...init?.headers } });

const hostOf = (url: string) => { try { return new URL(url).host; } catch { return null; } };

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response>;

/**
 * Wraps a route handler: enforces a valid session, blocks cross-origin POSTs,
 * and turns thrown HttpErrors into JSON error responses.
 */
export function route<C = unknown>(handler: Handler<C>, { auth = true } = {}): Handler<C> {
  return async (req, ctx) => {
    try {
      if (auth) {
        const user = readSession(req.cookies.get(SESSION_COOKIE)?.value);
        if (!user) throw new HttpError(401, 'Please sign in');
        if (!user.modules.includes('calls')) throw new HttpError(403, 'You do not have access to voice calls');
      }
      if (req.method !== 'GET') {
        const origin = req.headers.get('origin');
        if (origin && hostOf(origin) !== (req.headers.get('x-forwarded-host') ?? req.headers.get('host'))) {
          throw new HttpError(403, 'Bad origin');
        }
      }
      return await handler(req, ctx);
    } catch (err) {
      unstable_rethrow(err); // let Next's own control-flow errors (e.g. prerender bailout) through
      const status = err instanceof HttpError || err instanceof WorkspaceError ? err.status : 500;
      if (status === 500) console.error(err);
      return json({ error: status === 500 ? 'Something went wrong' : (err as Error).message }, { status });
    }
  };
}

export async function readJson<T = Record<string, unknown>>(req: NextRequest): Promise<T> {
  const text = await req.text();
  if (text.length > 5 * 1024 * 1024) throw new HttpError(413, 'Request too large');
  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}
