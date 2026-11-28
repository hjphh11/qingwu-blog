import { hexOf } from './common';

const enc = new TextEncoder();
export const PBKDF2_ITER = 150_000;

export async function pbkdf2(password: string, salt: string, iterations = PBKDF2_ITER): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations, hash: 'SHA-256' },
    key,
    256,
  );
  return hexOf(bits);
}
