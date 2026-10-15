// Prints a password hash for the app_users table.
// Usage: npm run user:hash -- 'the-password'
import { randomBytes, scryptSync } from 'node:crypto';

const password = process.argv[2];
if (!password) {
  console.error("Usage: npm run user:hash -- 'the-password'");
  process.exit(1);
}
const N = 16384, r = 8, p = 1;
const salt = randomBytes(16);
const hash = scryptSync(password, salt, 64, { N, r, p });
console.log(`scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${hash.toString('base64url')}`);
