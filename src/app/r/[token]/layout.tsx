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
 * Icons and Open Graph are inherited from the root layout.
 */
export const metadata: Metadata = {
  title: 'Write a review',
  robots: { index: false },
};

export default function ReviewRequestLayout({ children }: { children: React.ReactNode }) {
  return children;
}
