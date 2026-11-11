import { HttpException } from '@nestjs/common';
import bcrypt from 'bcryptjs';

/**
 * The "current password" asked for by a signed-in person (to change it, or to change two-step
 * sign-in). Without a limit, someone holding a stolen session could guess it there: 5 wrong tries
 * per account, then 15 minutes' wait. In memory, like the sign-in limits.
 */
const WINDOW_MS = 15 * 60_000;
const MAX_WRONG = 5;
const wrong = new Map<string, { count: number; first: number }>();

export async function currentPasswordMatches(accountId: string, password: string | undefined, hash: string): Promise<boolean> {
  const now = Date.now();
  const f = wrong.get(accountId);
  if (f && now - f.first < WINDOW_MS && f.count >= MAX_WRONG) {
    throw new HttpException('Too many wrong passwords. Try again in 15 minutes.', 429);
  }
  if (password && (await bcrypt.compare(password, hash))) {
    wrong.delete(accountId);
    return true;
  }
  if (password) wrong.set(accountId, !f || now - f.first >= WINDOW_MS ? { count: 1, first: now } : { count: f.count + 1, first: f.first });
  return false;
}
