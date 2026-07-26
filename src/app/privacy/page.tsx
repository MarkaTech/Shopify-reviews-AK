import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy — ReviewMaster',
  description: 'How ReviewMaster collects, uses, stores and deletes data for Shopify merchants and their customers.',
};

const LAST_UPDATED = '26 July 2026';
const CONTACT_EMAIL = 'tech@houseofmarka.com';

export default function PrivacyPolicy() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-slate-800 dark:text-slate-200">
      <Link href="/" className="text-sm text-emerald-700 hover:underline dark:text-emerald-400">
        &larr; Back to ReviewMaster
      </Link>

      <h1 className="mt-6 text-3xl font-bold tracking-tight">Privacy Policy</h1>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Last updated: {LAST_UPDATED}</p>

      <div className="prose prose-slate dark:prose-invert mt-8 max-w-none space-y-6 text-[15px] leading-relaxed">

        <section>
          <h2 className="text-xl font-semibold">1. Who we are</h2>
          <p>
            ReviewMaster (&quot;the App&quot;, &quot;we&quot;, &quot;us&quot;) is a product review application for
            Shopify stores. This policy explains what information the App collects, why it is
            collected, how long it is kept, and how it can be removed.
          </p>
          <p>
            This policy covers two groups of people: <strong>merchants</strong> who install the App on
            their Shopify store, and <strong>customers</strong> of those merchants whose review data may
            pass through the App.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">2. Information we collect</h2>

          <h3 className="mt-4 font-semibold">From merchants</h3>
          <p>When you install the App, Shopify provides us with:</p>
          <ul className="list-disc pl-6">
            <li>Your store name, myshopify domain and primary domain</li>
            <li>The email address associated with your Shopify account</li>
            <li>An access token permitting the App to make API requests on your behalf</li>
          </ul>

          <h3 className="mt-4 font-semibold">From your store, via the Shopify API</h3>
          <ul className="list-disc pl-6">
            <li>Product information: titles, handles, descriptions, images, prices, vendors and tags</li>
            <li>Order events, used only to determine when a review request may be sent and to mark a review as a verified purchase</li>
            <li>Theme information, where required to place review widgets on your storefront</li>
          </ul>

          <h3 className="mt-4 font-semibold">From your customers</h3>
          <ul className="list-disc pl-6">
            <li>Reviewer name, and email address where supplied</li>
            <li>Review content: rating, title, body text, and any images or video submitted</li>
            <li>Approximate location, where supplied</li>
            <li>Basic usage events such as when a review was viewed or marked helpful</li>
          </ul>

          <p>
            We do <strong>not</strong> collect payment card details, and we do not have access to them.
            All billing is processed by Shopify.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">3. How we use information</h2>
          <ul className="list-disc pl-6">
            <li>To provide the App: storing, displaying and managing product reviews</li>
            <li>To authenticate requests from your store</li>
            <li>To send review request emails on your behalf, where you have enabled that feature</li>
            <li>To produce analytics shown in your dashboard</li>
            <li>To diagnose errors and maintain service reliability</li>
          </ul>
          <p>
            We do not sell personal information. We do not use review data to train machine learning
            models. We do not share data with advertisers.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">4. Where data is stored and how it is protected</h2>
          <p>
            Data is stored in a PostgreSQL database hosted on Microsoft Azure. Access tokens are
            encrypted at rest using AES-256-GCM. All traffic between your browser, your store and the
            App is encrypted in transit using HTTPS.
          </p>
          <p>
            Each merchant&apos;s data is logically separated. Every record is associated with a single
            store, and every query is filtered by that store. One merchant cannot access another
            merchant&apos;s reviews, products or settings.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">5. How long we keep data</h2>
          <ul className="list-disc pl-6">
            <li><strong>While installed:</strong> data is retained for as long as the App remains installed on your store.</li>
            <li><strong>On uninstall:</strong> your access token is deleted immediately and the store is deactivated.</li>
            <li><strong>48 hours after uninstall:</strong> Shopify sends a shop redaction request, at which point all data associated with your store is permanently deleted.</li>
            <li><strong>Customer erasure requests:</strong> personal details attached to a review are removed within 30 days of the request. The rating and review text may be retained in anonymised form, as this is the merchant&apos;s business record.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold">6. Your rights</h2>
          <p>
            Depending on where you live, you may have the right to access, correct, export or delete
            personal information we hold about you, to object to certain processing, and to lodge a
            complaint with a supervisory authority.
          </p>
          <p>
            If you are a shopper who left a review, please contact the merchant whose store you
            reviewed. They can raise the request with us through Shopify, and we respond within 30
            days. You may also contact us directly at{' '}
            <a className="text-emerald-700 hover:underline dark:text-emerald-400" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">7. Sub-processors</h2>
          <ul className="list-disc pl-6">
            <li><strong>Microsoft Azure</strong> — application hosting and database storage</li>
            <li><strong>Shopify</strong> — merchant authentication, billing and API access</li>
          </ul>
          <p>We will update this list before adding any new sub-processor that handles personal data.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">8. Cookies</h2>
          <p>
            The App sets a single essential cookie to keep merchants signed in to the dashboard. It
            contains a store identifier and a signature, and is required for the App to function. We
            do not use advertising or tracking cookies.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">9. Children</h2>
          <p>
            The App is not directed at children and we do not knowingly collect personal information
            from anyone under 16. If you believe a child has submitted information, contact us and we
            will delete it.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">10. Changes to this policy</h2>
          <p>
            We may update this policy as the App evolves. Material changes will be communicated to
            installed merchants. The date at the top of this page always reflects the current version.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">11. Contact</h2>
          <p>
            Questions about this policy, or about data we hold, can be sent to{' '}
            <a className="text-emerald-700 hover:underline dark:text-emerald-400" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>.
          </p>
        </section>

      </div>
    </main>
  );
}
