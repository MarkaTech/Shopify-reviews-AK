import type { Metadata } from 'next';

/**
 * Metadata for the review page a buyer opens from their order email.
 *
 * The page itself is a client component and cannot export metadata, so what the buyer saw
 * in the browser tab — and in any link preview — was the root layout's marketing title,
 * "Marka Reviews — The Ultimate Shopify Review App", on a page that is the merchant's brand
 * in front of their customer. This server layout for the segment gives the tab its own
 * name and keeps the page out of search: robots.txt already disallows /r/, and the meta tag
 * covers a link a crawler reaches some other way, since each one is personal to an order.
 * Description and Open Graph are neutral on purpose: inherited from the root layout they
 * carried app marketing and the Marka icon into a buyer's link preview, including for a
 * white-label merchant — and a static layout cannot read the plan to tell them apart.
 */
const DESCRIPTION = 'Share your experience with your recent order.';
export const metadata: Metadata = {
  title: 'Write a review',
  description: DESCRIPTION,
  robots: { index: false },
  openGraph: { title: 'Write a review', description: DESCRIPTION, images: [] },
};

export default function ReviewRequestLayout({ children }: { children: React.ReactNode }) {
  return children;
}
