import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withAuth, unauthorizedResponse } from '@/lib/auth';
import { resolveMediaUrls } from '@/lib/media';

/**
 * Resolve media that was still processing when its review was submitted.
 *
 * Shopify's file pipeline is asynchronous. Images are usually ready within a second, but
 * video transcoding can take minutes — far longer than a shopper should wait staring at a
 * form. So the submit endpoint keeps the file GIDs in `pendingMedia` and returns, and this
 * turns those GIDs into CDN URLs once Shopify has finished.
 *
 * Called by the admin when it sees pending rows. Cheap and idempotent: rows that resolve
 * are cleared, rows still processing are left for the next run.
 */
export async function POST(request: NextRequest) {
  try {
    const { storeId, shop, accessToken, onUnauthorized } = await withAuth(request);

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

    return NextResponse.json({ success: true, reviewsChecked: pending.length, resolved, stillPending });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('[media/resolve]', error);
    return NextResponse.json({ error: 'Failed to resolve media' }, { status: 500 });
  }
}
