/**
 * OAuth CSRF nonce management (database-backed).
 *
 * This was previously an in-memory Map. That breaks in production: Azure Web App
 * restarts the container on deploy, scale, or idle recycle, and any merchant who was
 * mid-install at that moment gets "invalid_state" and has to start over. It also fails
 * outright the moment the app runs on more than one instance, because the callback can
 * land on a different container than the one that issued the nonce.
 *
 * Nonces are single-use and expire after 10 minutes.
 */

import crypto from 'crypto';
import { db } from './db';

const NONCE_EXPIRY_MS = 10 * 60 * 1000;

/** Create a single-use nonce bound to a shop, and persist it. */
export async function createNonce(shop: string): Promise<string> {
  const nonce = crypto.randomBytes(32).toString('hex');

  await db.oAuthNonce.create({
    data: {
      nonce,
      shop,
      expiresAt: new Date(Date.now() + NONCE_EXPIRY_MS),
    },
  });

  // Opportunistic cleanup of expired rows; cheap, and keeps the table small without a cron.
  db.oAuthNonce
    .deleteMany({ where: { expiresAt: { lt: new Date() } } })
    .catch((err: unknown) => console.error('Nonce cleanup failed:', err));

  return nonce;
}

/**
 * Verify a nonce and consume it.
 *
 * Returns the shop the nonce was issued for, or null if it is unknown, expired, or
 * already used. The caller must check that this matches the `shop` query parameter —
 * otherwise a nonce issued for one store could be replayed to authorise another.
 */
export async function verifyAndConsumeNonce(nonce: string): Promise<string | null> {
  if (!nonce) return null;

  const existing = await db.oAuthNonce.findUnique({ where: { nonce } });
  if (!existing) return null;

  // deleteMany acts as an atomic compare-and-consume: if two callbacks race on the same
  // nonce, exactly one of them deletes a row and the other sees count === 0.
  const { count } = await db.oAuthNonce.deleteMany({ where: { nonce } });
  if (count === 0) return null;

  if (existing.expiresAt.getTime() < Date.now()) return null;

  return existing.shop;
}
