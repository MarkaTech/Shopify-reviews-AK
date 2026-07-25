import { NextRequest, NextResponse } from 'next/server';
import { createShopifyAuthUrl } from '@/lib/shopify';
import { createSessionCookie } from '@/lib/auth';
import { createNonce } from '@/lib/nonce';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const shop = searchParams.get('shop');

  // Validate shop parameter
  if (!shop || !/^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/.test(shop)) {
    return NextResponse.redirect(
      `${process.env.SHOPIFY_APP_URL || 'http://localhost:3000'}?error=invalid_shop`
    );
  }

  // Generate and persist the state nonce for CSRF protection (now database-backed)
  const state = await createNonce(shop);

  // Build OAuth URL
  const authUrl = createShopifyAuthUrl(shop, state);

  // Redirect to Shopify OAuth
  return NextResponse.redirect(authUrl);
}
