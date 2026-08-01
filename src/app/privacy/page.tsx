import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy — ReviewMaster',
  description: 'How ReviewMaster collects, uses, stores and deletes data for Shopify merchants and their customers.',
};

const LAST_UPDATED = '31 July 2026';
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
          <h2 className="text-xl font-semibold">2. What the App may access on your store</h2>
          <p>
            The App requests the following Shopify access scopes, and what it does with each is
            listed beside it:
          </p>
          <ul className="list-disc pl-6">
            <li><code>read_products</code> — sync your product catalogue so reviews can be attached to the right product</li>
            <li><code>write_products</code> — write each product&apos;s average rating and review count back to Shopify product metafields, so your theme, Google and the Shop app read an accurate figure</li>
            <li><code>read_orders</code> — receive order webhooks, so a review invitation can be sent after an order is fulfilled and a review can be matched to a real order</li>
            <li><code>read_customers</code> — order webhook payloads carry the buyer&apos;s name and email address, which is what the review invitation is sent to</li>
            <li><code>write_files</code> — upload review photos and video into <strong>your own</strong> Shopify Files (see section 5)</li>
            <li><code>write_discounts</code> — create the discount code behind a review incentive, if you choose to run one. Nothing is created unless you switch an incentive on.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold">3. Information we collect</h2>

          <h3 className="mt-4 font-semibold">From merchants</h3>
          <p>When you install the App, Shopify provides us with:</p>
          <ul className="list-disc pl-6">
            <li>Your store name, myshopify domain and primary domain</li>
            <li>The email address on your Shopify shop record</li>
            <li>An offline access token, and a refresh token used to renew it, permitting the App to make API requests on your behalf</li>
          </ul>
          <p>
            We also store your subscription tier, your install date, your widget configurations,
            your App settings, and your notification preferences.
          </p>

          <h3 className="mt-4 font-semibold">From your store, via the Shopify API and webhooks</h3>
          <ul className="list-disc pl-6">
            <li>Product information: title, handle, description, image, price, vendor, product type and tags</li>
            <li>Order webhooks. When an order is paid we record an analytics event that includes the order id, order number, order total and the buyer&apos;s email address. When an order is fulfilled we create a review invitation holding the buyer&apos;s email address, name, order number, Shopify order id and a snapshot of the items in that order.</li>
            <li>Subscription webhooks, used to keep your plan in step with what Shopify says is active</li>
          </ul>

          <h3 className="mt-4 font-semibold">From your customers</h3>
          <ul className="list-disc pl-6">
            <li>Reviewer name (or &quot;Anonymous&quot; where you allow anonymous reviews)</li>
            <li>Reviewer email address, where supplied or where you require it. It is used for duplicate detection, for verification, and to answer erasure requests — it is never shown publicly.</li>
            <li>Review content: star rating, title and body text</li>
            <li>Review photos and video, stored in your Shopify Files rather than on our servers (section 5)</li>
            <li>Reviewer location, only when a merchant supplies it — through a CSV import, or by typing it into the dashboard. The App does not derive location from an IP address or any other signal.</li>
            <li>The Shopify order id, for reviews submitted through a post-purchase invitation link. This is what makes a &quot;verified purchase&quot; badge truthful; it is never sent to a shopper&apos;s browser.</li>
            <li>Questions asked on a product page: the asker&apos;s name, their question, and their email address where supplied so they can be told when it is answered. The asker&apos;s email is never shown publicly.</li>
            <li>Where a merchant runs a review incentive, the customer email a discount code was issued to, along with the code and its expiry</li>
          </ul>

          <h3 className="mt-4 font-semibold">Helpful votes and IP addresses</h3>
          <p>
            When a shopper clicks &quot;was this helpful&quot;, the App takes a SHA-256 hash of their
            IP address combined with the review id and holds that hash in the server&apos;s memory
            for one hour, so the same address cannot repeatedly inflate one review&apos;s count. This
            is processing of an IP address and we disclose it for that reason. The hash is never
            written to the database, the IP address itself is never stored, and the whole set is
            discarded when the server restarts.
          </p>

          <p>
            We do <strong>not</strong> collect payment card details, and we do not have access to them.
            All billing is processed by Shopify.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">4. How we use information</h2>
          <ul className="list-disc pl-6">
            <li>To provide the App: storing, moderating, displaying and syndicating product reviews and questions</li>
            <li>To authenticate requests from your store</li>
            <li>To email review invitations to your buyers on your behalf, and to email you when a review arrives or a weekly summary is due</li>
            <li>To produce the analytics shown in your dashboard</li>
            <li>To enforce the limits of your subscription plan</li>
            <li>To diagnose errors and maintain service reliability</li>
          </ul>
          <p>
            We do not sell personal information. We do not share data with advertisers. The App
            does not send review content to any third-party AI or machine-learning service, and
            review text is never generated or rewritten by the App — it is always what the
            reviewer wrote.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">5. Review photos and video</h2>
          <p>
            Photos and video submitted with a review are <strong>not stored on our servers</strong>.
            They are validated and then uploaded directly into your own Shopify Files, and served
            from Shopify&apos;s CDN. What we keep in our database is the resulting Shopify URL.
          </p>
          <p>
            Two consequences worth stating plainly. The media sits inside your Shopify account, so
            it stays with you if you uninstall the App. And because it is public on Shopify&apos;s
            CDN, anyone with the URL can view it — the same as any other image on your storefront.
          </p>
          <p>
            Uploads are limited to five images (10MB each) and one video (50MB), 80MB per
            submission, restricted to JPG, PNG, GIF, WebP, MP4, MOV and WebM, and checked against
            the file&apos;s actual leading bytes rather than the type the browser claims. SVG is
            refused because it can carry script.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">6. What is shown publicly</h2>
          <p>
            The storefront widget calls a public, unauthenticated, read-only endpoint from the
            shopper&apos;s browser. Only <em>published</em> reviews are returned, and only these
            fields: review id, reviewer name, reviewer location, star rating, title, body, image
            and video URLs, review date, verification status, whether the review was incentivised,
            the helpful count, the merchant&apos;s public reply and its date, and the source.
          </p>
          <p>
            <strong>Reviewer email addresses are deliberately not part of that response</strong>, and
            neither is the Shopify order id, the custom-fields blob or any internal sync state.
            The same applies to Q&amp;A: the asker&apos;s email address is never returned.
          </p>
          <p>
            Where you enable the Google Merchant Center feed, reviews are served at a
            token-protected URL for Google&apos;s crawler containing reviewer name, rating, title,
            body, date and the incentivised flag — again, no email address. Where Shopify has
            approved your store for the Shop app review programme, published reviews may also be
            written into Shopify&apos;s standard review metaobject; incentivised reviews are
            excluded from that entirely, because Shop&apos;s guidelines do not permit them.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">7. Where data is stored and how it is protected</h2>
          <p>
            The App runs as a container on Microsoft Azure Web Apps, and data is stored in an Azure
            Database for PostgreSQL Flexible Server. The database connection requires TLS, and all
            traffic between your browser, your store and the App is encrypted in transit using
            HTTPS.
          </p>
          <p>
            Shopify access tokens and refresh tokens are encrypted at rest with
            <strong> AES-256-GCM</strong> (96-bit nonce, authenticated), using a key derived with
            scrypt from a secret held only in the App&apos;s environment settings. No other field is
            encrypted at the application layer.
          </p>
          <p>
            Each merchant&apos;s data is logically separated. Every record is associated with a single
            store, and every query is filtered by that store. One merchant cannot access another
            merchant&apos;s reviews, products or settings.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">8. Cookies and browser storage</h2>
          <p>
            The App sets one cookie, <code>reviewmaster_session</code>. It contains your myshopify
            domain, an internal store identifier and an issued-at timestamp, signed with
            HMAC-SHA256 so it cannot be altered. It lasts 30 days and is then rejected.
          </p>
          <p>
            The Shopify access token is <strong>not</strong> in the cookie. The cookie payload is
            signed, not encrypted, so the token is held encrypted in the database and looked up
            server-side instead. We use no advertising or tracking cookies.
          </p>
          <p>
            The storefront widget sets no cookie. It does write two small values into the
            shopper&apos;s own browser storage: a <code>rm-helpful-&lt;review id&gt;</code> flag in
            localStorage, so a review they already marked helpful shows as already voted, and
            <code> rm-popup-seen</code> in sessionStorage, so a dismissed popup widget stays
            dismissed for that visit. Neither leaves the browser, neither contains personal
            information, and blocking storage only means the button stops remembering.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">9. How long we keep data, and how it is deleted</h2>
          <p>
            The App implements Shopify&apos;s three mandatory compliance webhooks. This is what each
            one does:
          </p>
          <ul className="list-disc pl-6">
            <li>
              <strong><code>customers/data_request</code></strong> — we look up every review held for
              that customer&apos;s email address on that shop, including the reviewer name, email,
              location, rating, title, body and date, and record the result so the merchant can
              pass it to the customer. Shopify&apos;s 30-day response window applies.
            </li>
            <li>
              <strong><code>customers/redact</code></strong> — on receipt, every review matching that
              email address is anonymised immediately. The reviewer name becomes
              &quot;Anonymous&quot;, and the email address, avatar, location, SEO fields and custom
              fields are cleared. The star rating and the review text are retained, because they
              are the merchant&apos;s business record and no longer identify anyone.
            </li>
            <li>
              <strong><code>shop/redact</code></strong> — Shopify sends this 48 hours after uninstall.
              We permanently delete the store&apos;s reviews, products, import history, widget
              configurations, settings and analytics events, then the store record itself, which
              also removes its questions and answers, incentive configuration and issued discount
              records, and cached rating aggregates.
            </li>
          </ul>
          <p>Outside those webhooks:</p>
          <ul className="list-disc pl-6">
            <li><strong>While installed:</strong> data is retained for as long as the App remains installed on your store.</li>
            <li><strong>On uninstall:</strong> your access token and refresh token are deleted from our database immediately and the store is deactivated, so the storefront endpoints stop serving it. The remaining data is erased 48 hours later by <code>shop/redact</code>.</li>
            <li><strong>Review invitations:</strong> the single-use link emailed to a buyer stops working 60 days after it is created.</li>
            <li><strong>Helpful-vote hashes:</strong> held in memory for one hour and never persisted.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold">10. Your rights</h2>
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
          <h2 className="text-xl font-semibold">11. Sub-processors</h2>
          <ul className="list-disc pl-6">
            <li><strong>Microsoft Azure</strong> — application hosting and database storage</li>
            <li><strong>Shopify</strong> — merchant authentication, billing, the Admin API, and storage and delivery of review photos and video through your own Shopify Files</li>
            <li>
              <strong>One transactional email provider</strong>, whichever the App is configured with:
              Amazon SES, Resend or SendGrid. It receives the recipient&apos;s email address and the
              content of the message — a review invitation to your buyer, or a review notification
              to you. With no provider configured, no email is sent at all and review invitation
              links have to be shared manually.
            </li>
          </ul>
          <p>We will update this list before adding any new sub-processor that handles personal data.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">12. Children</h2>
          <p>
            The App is not directed at children and we do not knowingly collect personal information
            from anyone under 16. If you believe a child has submitted information, contact us and we
            will delete it.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">13. Changes to this policy</h2>
          <p>
            We may update this policy as the App evolves. Material changes will be communicated to
            installed merchants. The date at the top of this page always reflects the current version.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">14. Contact</h2>
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
