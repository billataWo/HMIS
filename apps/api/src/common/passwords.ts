import bcrypt from 'bcryptjs';

/**
 * Passwords are stored as bcrypt hashes (salted) with a work factor of 12: about a quarter of a
 * second per guess on a server, which is what makes a stolen database slow to crack.
 */
export const BCRYPT_COST = 12;

export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_COST);

/** A hash made with a lower work factor (before November 2026): replace it at the next sign-in. */
export const needsRehash = (hash: string) => {
  try {
    return bcrypt.getRounds(hash) < BCRYPT_COST;
  } catch {
    return false;
  }
};

/** Compared against when the account does not exist, so an unknown name takes as long as a known one. */
export const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_COST);

/**
 * A temporary password (set by an admin, or by HMIS for a new clinic or operator) works until the
 * person chooses their own, and for at most this long: one written down for someone who never
 * signs in does not stay valid. Long enough to be handed over before the next shift.
 */
export const TEMPORARY_PASSWORD_HOURS = 72;
export const temporaryPasswordExpiry = (now = new Date()) => new Date(now.getTime() + TEMPORARY_PASSWORD_HOURS * 3_600_000);

/** The temporary password has run out (only while it must still be replaced). */
export const temporaryPasswordExpired = (u: { mustChangePassword: boolean; temporaryPasswordExpiresAt: Date | null }, now = new Date()) =>
  u.mustChangePassword && !!u.temporaryPasswordExpiresAt && u.temporaryPasswordExpiresAt < now;
