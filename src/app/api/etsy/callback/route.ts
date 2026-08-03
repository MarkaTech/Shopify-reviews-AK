import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { completeEtsyConnect, EtsyError } from '@/lib/etsy';
import { SHOPIFY_APP_URL } from '@/lib/shopify';

/**
 * Public OAuth callback. Etsy redirects here with ?code and our ?state.
 *
 * The state nonce is single-use and maps to the store through the OAuthNonce table —
 * the caller is never trusted to say which store they are. Everything renders as a
 * plain page because this lands in a top-level browser tab, outside the embedded admin.
 */
export const dynamic = 'force-dynamic';

function page(title: string, body: string): NextResponse {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family:-apple-system,sans-serif;padding:48px;text-align:center">
<h1 style="font-size:20px">${title}</h1><p style="color:#555">${body}</p>
<p><a href="${SHOPIFY_APP_URL}">Back to ReviewMaster</a></p></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code') || '';
  const state = searchParams.get('state') || '';

  if (!code || !state) {
    return page('Connection cancelled', 'Etsy did not complete the authorisation. You can close this tab and try again.');
  }

  const nonce = await db.oAuthNonce.findUnique({ where: { nonce: state } });
  if (!nonce || nonce.expiresAt.getTime() < Date.now() || !nonce.shop.startsWith('etsy:')) {
    return page('Connection expired', 'This authorisation link has expired. Start again from the Import page.');
  }
  await db.oAuthNonce.delete({ where: { nonce: state } }).catch(() => {});
  const storeId = nonce.shop.slice('etsy:'.length);

  try {
    await completeEtsyConnect(storeId, code, SHOPIFY_APP_URL);
    return page('Etsy connected', 'You can close this tab. Back in ReviewMaster, use "Sync now" on the Import page to pull your reviews.');
  } catch (error) {
    const message = error instanceof EtsyError ? error.merchantMessage : 'Something went wrong finishing the connection.';
    console.error('[etsy/callback]', error);
    return page('Connection failed', message);
  }
}
