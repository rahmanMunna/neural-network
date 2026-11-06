// #region passwords
import argon2 from "argon2";

/** argon2id is slow and memory-hard on purpose, which makes guessing expensive. */
export const hashPassword = (password: string) => argon2.hash(password, { type: argon2.argon2id });

// A real hash, used when the email is unknown. Without it, a login for an
// unknown account returns faster, and the timing reveals which emails exist.
const decoy = await hashPassword("decoy-password-never-matches");

export async function verifyPassword(stored: string | undefined, password: string) {
  const matches = await argon2.verify(stored ?? decoy, password);
  return stored !== undefined && matches;
}
// #endregion
