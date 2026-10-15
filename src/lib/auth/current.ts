import 'server-only';
import { cookies } from 'next/headers';
import { readSession, SESSION_COOKIE } from './session';

/** The signed-in user, for server components and route handlers. */
export async function currentUser() {
  return readSession((await cookies()).get(SESSION_COOKIE)?.value);
}
