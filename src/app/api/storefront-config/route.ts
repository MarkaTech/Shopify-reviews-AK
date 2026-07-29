import { NextRequest, NextResponse } from 'next/server';
import { withAuth, unauthorizedResponse } from '@/lib/auth';
import {
  getStorefrontConfig,
  saveStorefrontConfig,
  resetStorefrontConfig,
  DEFAULT_CONFIG,
} from '@/lib/storefront-config';

/** Merchant-facing read of the storefront appearance and copy. */
export async function GET(request: NextRequest) {
  try {
    const { storeId } = await withAuth(request);
    const config = await getStorefrontConfig(storeId);
    // Defaults ship alongside so the UI can show a "reset to default" affordance per field
    // without hardcoding the same strings in the client.
    return NextResponse.json({ config, defaults: DEFAULT_CONFIG });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('[storefront-config]', error);
    return NextResponse.json({ error: 'Failed to load configuration' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { storeId } = await withAuth(request);
    const body = (await request.json()) as { updates?: Record<string, string> };
    if (!body.updates || typeof body.updates !== 'object') {
      return NextResponse.json({ error: 'updates object is required' }, { status: 400 });
    }

    const result = await saveStorefrontConfig(storeId, body.updates);
    const config = await getStorefrontConfig(storeId);

    // Rejected keys are reported rather than silently dropped — a merchant who typed an
    // invalid colour deserves to know the save did not fully apply.
    return NextResponse.json({ success: true, ...result, config });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('[storefront-config PUT]', error);
    return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { storeId } = await withAuth(request);
    await resetStorefrontConfig(storeId);
    return NextResponse.json({ success: true, config: DEFAULT_CONFIG });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    return NextResponse.json({ error: 'Failed to reset configuration' }, { status: 500 });
  }
}
