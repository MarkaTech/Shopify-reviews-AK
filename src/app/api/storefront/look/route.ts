import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getStorefrontConfig } from '@/lib/storefront-config';

/**
 * The merchant's look on its own: star shape, badge icon, font, colours and custom CSS.
 *
 * Why a second endpoint when the reviews payload already carries all of this. The review
 * list is fetched only when the block nears the viewport (an IntersectionObserver with a
 * 400 px margin), which is right for a list that is usually below the fold and wrong for
 * the marks that payload publishes on the page. The star block under the product title is
 * rendered by Liquid with the Marka tick-star and takes the merchant's shape, colour and
 * font by inheritance from the document root — so on a store that chose the classic star,
 * the stars under the title changed shape only once the shopper scrolled down to the
 * reviews, and the font arrived the same way.
 *
 * The widget asks for this once per page, as early as it runs, and applies it before the
 * observer gate. A couple of hundred bytes for most stores, on the same cache policy as the
 * reviews payload. Same posture as the other storefront reads: no auth, open CORS, and
 * nothing in the response that is not already on the merchant's storefront.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Edge-cached like the reviews payload, and deliberately not browser-cached: the widget
// only ever fills a colour that is not already set, so a stale value applied early would
// outrank the fresh one the reviews payload brings a moment later.
const CACHE = 'public, s-maxage=300, stale-while-revalidate=3600';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const shop = searchParams.get('shop');
    // Same meaning as on the reviews route: the widget the merchant designed for this
    // placement layers its choices over the store's. Null still resolves a single widget.
    const placement = searchParams.get('placement');
    if (!shop) return NextResponse.json({ error: 'shop is required' }, { status: 400, headers: CORS });

    const store = await db.store.findUnique({
      where: { shopifyDomain: shop },
      select: { id: true, isActive: true },
    });
    if (!store?.isActive) {
      return NextResponse.json({ error: 'Unknown store' }, { status: 404, headers: CORS });
    }

    const config = await getStorefrontConfig(store.id, placement);

    return NextResponse.json(
      {
        colors: config.colors,
        layout: {
          starStyle: config.layout.starStyle,
          badgeIcon: config.layout.badgeIcon,
          fontFamily: config.layout.fontFamily,
        },
        customCss: config.customCss,
      },
      { headers: { ...CORS, 'Cache-Control': CACHE } }
    );
  } catch (error) {
    console.error('[storefront/look]', error);
    return NextResponse.json({ error: 'Failed to load storefront look' }, { status: 500, headers: CORS });
  }
}
