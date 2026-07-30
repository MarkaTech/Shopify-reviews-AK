/**
 * Cross-tenant ownership checks.
 *
 * The database is shared by every merchant and every row is scoped by `storeId`. Route
 * handlers are careful about the record they are addressing — a review update always
 * confirms the review belongs to the caller's store first. The gap this module closes is
 * the *other* kind of identifier: one the caller supplies as a **value**, not as the thing
 * being addressed.
 *
 * `productId` is the case that mattered. It arrives from the request in three places (a
 * CSV import's fallback product, a review create, a review update) and flows into
 * `updateProductRating`, whose sink keys on `productId` alone because `ProductRating.
 * productId` is globally unique. Passing another merchant's product id therefore rewrote
 * that merchant's star rating and pushed it to their storefront metafields — with nothing
 * in their account to explain it.
 *
 * The identifiers are cuids and are not exposed publicly, so this was authorisation
 * protected by entropy rather than an openly enumerable hole. That is not a control.
 */

import { db } from './db';

export class OwnershipError extends Error {
  status = 404;
  constructor(message = 'Not found') {
    super(message);
    this.name = 'OwnershipError';
  }
}

/**
 * Confirm a product id belongs to this store, and return it.
 *
 * Returns null for null/empty input, so callers can pass an optional field straight
 * through: `productId: await assertProductInStore(storeId, body.productId)`.
 *
 * Reports "not found" rather than "forbidden" on a mismatch. A merchant probing ids should
 * not be able to tell the difference between an id that does not exist and one that
 * belongs to somebody else.
 */
export async function assertProductInStore(
  storeId: string,
  productId: unknown
): Promise<string | null> {
  if (productId === null || productId === undefined || productId === '') return null;
  if (typeof productId !== 'string') {
    throw new OwnershipError('Invalid product');
  }

  const product = await db.product.findFirst({
    where: { id: productId, storeId },
    select: { id: true },
  });
  if (!product) throw new OwnershipError('Product not found');

  return product.id;
}

/** Map an OwnershipError to a response body, or null if this is a different error. */
export function ownershipErrorResponse(
  error: unknown
): { status: number; body: { error: string } } | null {
  if (error instanceof OwnershipError) {
    return { status: error.status, body: { error: error.message } };
  }
  return null;
}
