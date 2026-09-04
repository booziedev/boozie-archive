import crypto from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Password hashing with scrypt.
 *
 * scrypt ships with Node, so there is no native module to compile — which
 * matters on a Raspberry Pi, where bcrypt/argon2 binaries are a common source
 * of failed installs. The parameters below are the Node defaults with a larger
 * cost factor, taking roughly 100 ms on a Pi 5.
 *
 * Stored format: scrypt$N$r$p$<salt-b64>$<hash-b64>
 */
const scrypt = promisify(crypto.scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

const N = 16384;
const r = 8;
const p = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const derived = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, {
    N,
    r,
    p,
    maxmem: 128 * N * r * 2,
  });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

/** Constant-time verification; returns false for any malformed stored value. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, rawN, rawR, rawP, saltB64, hashB64] = parts;
  const paramN = Number.parseInt(rawN!, 10);
  const paramR = Number.parseInt(rawR!, 10);
  const paramP = Number.parseInt(rawP!, 10);
  if (!Number.isFinite(paramN) || !Number.isFinite(paramR) || !Number.isFinite(paramP)) return false;

  let expected: Buffer;
  try {
    expected = Buffer.from(hashB64!, 'base64');
  } catch {
    return false;
  }

  let derived: Buffer;
  try {
    derived = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64!, 'base64'), expected.length, {
      N: paramN,
      r: paramR,
      p: paramP,
      maxmem: 128 * paramN * paramR * 2,
    });
  } catch {
    return false;
  }

  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

/** Opaque session token plus the SHA-256 that is what actually gets stored. */
export function createSessionToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Invite codes in Discord's shape: short, unambiguous, easy to read aloud.
 * The alphabet drops 0/O/1/I/l so a code can be copied off a screen reliably.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export function generateInviteCode(length = 8): string {
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  return code;
}
