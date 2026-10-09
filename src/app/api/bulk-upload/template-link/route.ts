import { NextRequest, NextResponse } from 'next/server';
import { withAuth, unauthorizedResponse } from '@/lib/auth';
import { issueDownloadToken } from '@/lib/download-token';

/**
 * A link the browser can open in a new tab to download this store's import template.
 *
 * The template is built from the store's catalogue, so it needs to know which store is
 * asking — and a tab opened on a URL cannot carry the session-token header the rest of
 * the app authenticates with. This route runs under the header, and hands back a URL
 * that carries a five-minute signed token instead. See src/lib/download-token.ts.
 */
export async function GET(request: NextRequest) {
  try {
    const { storeId } = await withAuth(request);
    const token = issueDownloadToken(storeId, 'import-template');
    return NextResponse.json({ url: `/api/bulk-upload?format=xlsx&t=${encodeURIComponent(token)}` });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('[bulk-upload/template-link] failed:', error);
    return NextResponse.json({ error: 'Could not prepare the template download.' }, { status: 500 });
  }
}
