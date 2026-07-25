/**
 * Token encryption at rest (AES-256-GCM).
 *
 * Shopify access tokens are long-lived credentials that grant full API access to a
 * merchant's store. Storing them as plaintext is a common cause of App Store review
 * rejection, and turns any read-only database leak into a full store compromise.
 *
 * Key: TOKEN_ENCRYPTION_KEY (preferred) or NEXTAUTH_SECRET (fallback), stretched to
 * 32 bytes with scrypt so any length of input secret is usable.
 *
 * Format: v1.<iv-b64url>.<authTag-b64url>.<ciphertext-b64url>
 * The version prefix lets existing plaintext rows be detected and migrated lazily.
 */

import crypto from 'crypto';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce, the recommended size for GCM
const SALT = 'reviewmaster.token.v1'; // static salt is fine: the input secret is already high-entropy

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const secret = process.env.TOKEN_ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY (or NEXTAUTH_SECRET) must be set and at least 32 characters. ' +
        'Generate one with: openssl rand -base64 32'
    );
  }

  cachedKey = crypto.scryptSync(secret, SALT, 32);
  return cachedKey;
}

/** Encrypt a Shopify access token for storage. */
export function encryptToken(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

/**
 * Decrypt a stored token.
 *
 * Values that do not carry the version prefix are assumed to be legacy plaintext and
 * returned as-is, so rows written before this change keep working. They are re-encrypted
 * on the next OAuth callback for that shop.
 */
export function decryptToken(stored: string | null | undefined): string | null {
  if (!stored) return null;

  const parts = stored.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    return stored; // legacy plaintext
  }

  try {
    const [, ivB64, tagB64, dataB64] = parts;
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      getKey(),
      Buffer.from(ivB64, 'base64url')
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));

    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    // Wrong key, or the ciphertext was tampered with. Never fall back to returning
    // the raw value here — that would leak ciphertext into an Authorization header.
    console.error('Failed to decrypt access token:', error);
    return null;
  }
}

/** True if the stored value is already encrypted with the current scheme. */
export function isEncrypted(stored: string | null | undefined): boolean {
  return !!stored && stored.split('.').length === 4 && stored.startsWith(`${VERSION}.`);
}
