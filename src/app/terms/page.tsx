import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service — ReviewMaster',
  description: 'The terms under which Shopify merchants may use the ReviewMaster review app.',
};

const LAST_UPDATED = '31 July 2026';
const CONTACT_EMAIL = 'tech@houseofmarka.com';

export default function TermsOfService() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-slate-800 dark:text-slate-200">
      <Link href="/" className="text-sm text-emerald-700 hover:underline dark:text-emerald-400">
        &larr; Back to ReviewMaster
      </Link>

      <h1 className="mt-6 text-3xl font-bold tracking-tight">Terms of Service</h1>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Last updated: {LAST_UPDATED}</p>

      <div className="prose prose-slate dark:prose-invert mt-8 max-w-none space-y-6 text-[15px] leading-relaxed">

        <section>
          <h2 className="text-xl font-semibold">1. Agreement</h2>
          <p>
            These terms govern your use of ReviewMaster (&quot;the App&quot;). By installing the App on
            your Shopify store you agree to them. If you do not agree, please uninstall the App.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">2. What the App does</h2>
          <p>The App lets Shopify merchants:</p>
          <ul className="list-disc pl-6">
            <li>Collect reviews through a storefront form, and through a single-use link emailed to a buyer after their order is fulfilled</li>
            <li>Import reviews you already own from a CSV file, including exports from other review apps</li>
            <li>Moderate reviews before they appear. Every review submitted through the storefront form or an invitation link arrives unpublished; auto-publish is a setting you can turn on, and it is off by default.</li>
            <li>Display reviews on your storefront through a theme app extension you place in the theme editor</li>
            <li>Accept photo and video reviews, which are stored in your own Shopify Files rather than on our servers</li>
            <li>Run product questions and answers</li>
            <li>Publish a Google Merchant Center product ratings feed, and — where Shopify has approved your store for its review syndication programme — write reviews into Shopify&apos;s standard review metaobject for the Shop app</li>
            <li>Offer a discount code in exchange for a review, under the rules in section 6</li>
          </ul>
          <p>
            The App does <strong>not</strong> scrape or import reviews from Amazon, eBay, Etsy,
            Alibaba or any other marketplace. That functionality has been removed: presenting
            reviews written about another seller&apos;s listing as reviews of your product is a
            misrepresentation under the FTC Rule on Consumer Reviews and Testimonials
            (16 CFR Part 465) and the EU Omnibus Directive.
          </p>
          <p>Which features you get depends on your plan, as set out in section 4.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">3. Your account</h2>
          <p>
            Access is tied to your Shopify store. You are responsible for activity that occurs through
            your store&apos;s access to the App, and for keeping your Shopify account secure.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">4. Plans, billing and trials</h2>
          <p>
            The App has three plans. Every plan includes unlimited stored reviews, unlimited
            widgets and unlimited imports; what differs is the number of review request
            emails sent per calendar month, and the feature set.
          </p>
          <ul className="list-disc pl-6">
            <li>
              <strong>Free — $0/month.</strong> Unlimited reviews, up to 100 review request
              emails per calendar month, all widget layouts, photo reviews, CSV, AliExpress
              and Etsy import, and Google rich snippets. Widgets carry ReviewMaster branding.
            </li>
            <li>
              <strong>Growth — $12/month.</strong> Up to 1,000 review request emails per
              calendar month, plus video reviews, automatic reminders, review incentives,
              questions and answers, the Google Shopping ratings feed, Shop app syndication,
              and removal of ReviewMaster branding.
            </li>
            <li>
              <strong>Scale — $39/month.</strong> Unlimited review request emails, everything
              in Growth, plus advanced analytics and priority support.
            </li>
          </ul>
          <ul className="list-disc pl-6">
            <li>Paid plans are billed by Shopify every 30 days and appear on your Shopify invoice.</li>
            <li>
              Every paid plan includes a <strong>30-day free trial</strong>. You are not charged
              during the trial, and you may cancel at any point before it ends without being
              charged. Unless you cancel, billing begins automatically when the trial ends.
            </li>
            <li>Prices are in USD and exclude any applicable taxes.</li>
            <li>
              Plan limits — the monthly review request allowance and per-feature access — are
              enforced on our servers, not in your browser. The monthly allowance resets at
              the start of each calendar month (UTC). Review requests that exceed your monthly
              allowance are <strong>deferred to the following month rather than discarded</strong>.
              Requests do expire 60 days after they were scheduled, so a store that remains
              over its allowance for an extended period may have the oldest deferred requests
              expire before they are sent.
            </li>
            <li>You may change or cancel your plan at any time. Your entitlement is resolved from what Shopify reports as your active subscription, so an upgrade, downgrade or cancellation takes effect through the same path.</li>
          </ul>
          <p>
            All payments run through Shopify&apos;s billing API. <strong>We never see, handle or
            store card details.</strong> Cancelling stops future charges. Because billing runs
            through Shopify, refunds are handled under Shopify&apos;s billing policies; we do not
            process payments directly and cannot issue card refunds ourselves.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">5. Reviews and verification</h2>
          <p>
            A review only carries a &quot;verified purchase&quot; badge when the App can point at a
            real Shopify order for it — that is, when it was submitted through the invitation link
            emailed to the buyer after fulfilment. Reviews submitted through the public storefront
            form, imported from CSV, or entered by hand are recorded as unverified and are never
            badged, whatever a source file claims. Claiming otherwise would be a misrepresentation
            under 16 CFR Part 465.
          </p>
          <p>
            The Google feed and Shop app syndication carry <em>all</em> your published reviews.
            There is no rating filter and no setting to add one: submitting only flattering reviews
            breaches Google&apos;s product ratings policy, Shopify&apos;s syndication programme, the
            FTC rule, the EU Omnibus Directive and the UK DMCC Act. Deleting or unpublishing a
            review flows through to the displayed average.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">6. Review incentives</h2>
          <p>
            You may offer a discount code to customers who leave a review. The App enforces the
            following, and you agree to them:
          </p>
          <ul className="list-disc pl-6">
            <li>
              <strong>A reward can never depend on what the review says.</strong> FTC 16 CFR 465.4
              prohibits conditioning compensation on the sentiment of a review, expressly or by
              implication. There is no minimum-rating setting in the App, and no code path that
              reads a rating before issuing a code — a one-star review earns exactly what a
              five-star review earns.
            </li>
            <li>
              Requiring a photo or video for a larger reward is permitted, because media is a
              content type and not an opinion.
            </li>
            <li>
              <strong>Incentivised reviews are disclosed.</strong> The offer is shown to the shopper
              before they write, and a disclosure notice is attached to every review that earned a
              reward. The incentivised flag travels with the review to the storefront and to the
              Google feed and cannot be suppressed.
            </li>
            <li>
              Incentivised reviews are excluded from Shop app syndication entirely, because
              Shopify&apos;s Shop guidelines prohibit compensated reviews with no disclosure
              carve-out.
            </li>
            <li>
              Codes are single-use, limited to one per customer, and expire on the schedule you set.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold">7. Acceptable use</h2>
          <p>You agree not to:</p>
          <ul className="list-disc pl-6">
            <li>Publish reviews you know to be false, fabricated or purchased</li>
            <li>Suppress or selectively delete reviews in order to misrepresent what your customers actually said</li>
            <li>Use the App to publish unlawful, defamatory, obscene or infringing content</li>
            <li>Import review content you do not have the right to reproduce, or review content written about a different seller&apos;s product</li>
            <li>Attempt to access another merchant&apos;s data</li>
            <li>Probe, scan, overload or interfere with the App or its infrastructure, including the public storefront endpoints</li>
            <li>Resell or redistribute the App without written permission</li>
          </ul>
          <p>
            Publishing fake or undisclosed incentivised reviews may breach consumer protection
            law in your jurisdiction. Responsibility for the reviews you publish rests with you.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">8. Your content</h2>
          <p>
            Reviews, product data and other material handled through the App remain yours. You grant
            us only the limited licence needed to host, process and display that content in order to
            provide the App.
          </p>
          <p>
            Review photos and video are uploaded into your own Shopify Files and remain in your
            Shopify account, including after you uninstall the App.
          </p>
          <p>
            You are responsible for ensuring you have the right to publish review content, including
            content imported from other platforms, and for moderating what appears on your storefront.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">9. Availability and support</h2>
          <p>
            We aim to keep the App available at all times but do not guarantee uninterrupted service.
            Maintenance, third-party outages and factors outside our control may cause downtime.
          </p>
          <p>
            Support is provided by email at{' '}
            <a className="text-emerald-700 hover:underline dark:text-emerald-400" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>. We aim to respond within two business days.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">10. Data and privacy</h2>
          <p>
            Our handling of personal information is described in the{' '}
            <Link className="text-emerald-700 hover:underline dark:text-emerald-400" href="/privacy">
              Privacy Policy
            </Link>
            , which forms part of these terms.
          </p>
          <p>
            Your customers&apos; personal data is a separate matter from your own account
            data, and it is governed by the{' '}
            <Link className="text-emerald-700 hover:underline dark:text-emerald-400" href="/dpa">
              Data Processing Agreement
            </Link>
            , which also forms part of these terms and takes effect when you install the App.
            No signature is needed. Under it you are the data controller and we are your
            processor: we act on your instructions, we do not use your customers&apos; data
            for our own purposes, and we do not sell or share it.
          </p>
          <p>
            It covers the categories of data involved, our security measures, retention
            periods, breach notification, and the Standard Contractual Clauses relied on for
            transfers out of the EEA and the UK. The third parties that process data on our
            behalf are listed at{' '}
            <Link className="text-emerald-700 hover:underline dark:text-emerald-400" href="/subprocessors">
              /subprocessors
            </Link>
            , and we give 30 days&apos; notice before adding to that list.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">11. Suspension and termination</h2>
          <p>
            You may stop using the App at any time by uninstalling it. We may suspend or terminate
            access if these terms are breached, if required by law, or if your use threatens the
            security or stability of the service.
          </p>
          <p>
            On uninstall, your Shopify access token and refresh token are deleted from our database
            immediately and your store is deactivated. Shopify then sends a shop redaction request
            48 hours later, at which point the rest of your data is erased as described in the
            Privacy Policy. If you want a copy of your review data, ask us at{' '}
            <a className="text-emerald-700 hover:underline dark:text-emerald-400" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>{' '}
            before you uninstall.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">12. Disclaimers</h2>
          <p>
            The App is provided on an &quot;as is&quot; and &quot;as available&quot; basis, without
            warranties of any kind to the fullest extent permitted by law. We do not warrant that the
            App will be error-free, or that it will increase your sales or conversion rate.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">13. Limitation of liability</h2>
          <p>
            To the fullest extent permitted by law, we are not liable for indirect, incidental or
            consequential losses, including lost profits, lost revenue or lost data. Our total
            liability arising out of these terms is limited to the amount you paid for the App in the
            twelve months preceding the claim.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">14. Changes to these terms</h2>
          <p>
            We may update these terms. Material changes will be communicated to installed merchants.
            Continuing to use the App after a change takes effect constitutes acceptance.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">15. Contact</h2>
          <p>
            Questions about these terms can be sent to{' '}
            <a className="text-emerald-700 hover:underline dark:text-emerald-400" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>.
          </p>
        </section>

      </div>
    </main>
  );
}
