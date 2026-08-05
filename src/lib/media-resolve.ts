import { db } from './db';
import { resolveMediaUrls } from './media';

/**
 * Turn pending media GIDs into CDN URLs once Shopify has finished processing them.
 *
 * Shopify's file pipeline is asynchronous. Images are usually ready within a second, but
 * video transcoding can take minutes — far longer than a shopper should wait staring at a
 * form. So the submit endpoints keep unready file GIDs in `pendingMedia` and return, and
 * this resolves them afterwards.
 *
 * Called in two places: the merchant opening the Reviews list (fire-and-forget from that
 * GET, which is the natural "someone is about to look at these" moment), and the manual
 * /api/media/resolve endpoint. Cheap and idempotent: rows that resolve are cleared, rows
 * still processing are left for the next run.
 */
export async function resolvePendingMedia(
  storeId: string,
  shop: string,
  accessToken: string,
  onUnauthorized?: () => Promise<string | null>
): Promise<{ reviewsChecked: number; resolved: number; stillPending: number }> {
  const pending = await db.review.findMany({
    where: { storeId, pendingMedia: { not: null } },
    select: { id: true, images: true, videoUrl: true, pendingMedia: true },
    take: 50,
  });

  let resolved = 0;
  let stillPending = 0;

  for (const review of pending) {
    let gids: string[];
    try {
      gids = JSON.parse(review.pendingMedia!) as string[];
    } catch {
      // Unparseable — clear it rather than retrying forever on bad data.
      await db.review.update({ where: { id: review.id }, data: { pendingMedia: null } });
      continue;
    }

    const media = await resolveMediaUrls(shop, accessToken, gids, onUnauthorized, 2);

    const existingImages: string[] = review.images ? JSON.parse(review.images) : [];
    let videoUrl = review.videoUrl;
    const unresolved: string[] = [];

    for (const m of media) {
      if (!m.url) {
        unresolved.push(m.gid);
        continue;
      }
      if (m.kind === 'video') videoUrl = m.url;
      else if (!existingImages.includes(m.url)) existingImages.push(m.url);
      resolved++;
    }

    stillPending += unresolved.length;

    await db.review.update({
      where: { id: review.id },
      data: {
        images: existingImages.length ? JSON.stringify(existingImages) : null,
        videoUrl,
        pendingMedia: unresolved.length ? JSON.stringify(unresolved) : null,
      },
    });
  }

  return { reviewsChecked: pending.length, resolved, stillPending };
}
