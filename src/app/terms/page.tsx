import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service — ReviewMaster',
  description: 'The terms under which Shopify merchants may use the ReviewMaster review app.',
};

const LAST_UPDATED = '26 July 2026';
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
          <p>
            The App allows Shopify merchants to collect, import, moderate and display product reviews
            on their storefront. Features available to you depend on your subscription plan.
          </p>
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
          <ul className="list-disc pl-6">
            <li>Paid plans are billed monthly through Shopify and appear on your Shopify invoice.</li>
            <li>Paid plans include a 7-day free trial unless stated otherwise. You are not charged during the trial.</li>
            <li>Prices are shown in USD and exclude any applicable taxes.</li>
            <li>Plan limits, including review counts and available widgets, are enforced by the App.</li>
            <li>You may change or cancel your plan at any time from your Shopify admin.</li>
          </ul>
          <p>
            Cancelling stops future charges. Because billing runs through Shopify, refunds are handled
            under Shopify&apos;s billing policies. We do not process payments directly and cannot
            issue card refunds ourselves.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">5. Acceptable use</h2>
          <p>You agree not to:</p>
          <ul className="list-disc pl-6">
            <li>Publish reviews you know to be false, fabricated or purchased</li>
            <li>Use the App to publish unlawful, defamatory, obscene or infringing content</li>
            <li>Import review content you do not have the right to reproduce</li>
            <li>Attempt to access another merchant&apos;s data</li>
            <li>Probe, scan, overload or interfere with the App or its infrastructure</li>
            <li>Resell or redistribute the App without written permission</li>
          </ul>
          <p>
            Publishing fake or incentivised reviews without disclosure may breach consumer protection
            law in your jurisdiction. Responsibility for the reviews you publish rests with you.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">6. Your content</h2>
          <p>
            Reviews, product data and other material handled through the App remain yours. You grant
            us only the limited licence needed to host, process and display that content in order to
            provide the App.
          </p>
          <p>
            You are responsible for ensuring you have the right to publish review content, including
            content imported from other platforms, and for moderating what appears on your storefront.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">7. Availability and support</h2>
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
          <h2 className="text-xl font-semibold">8. Data and privacy</h2>
          <p>
            Our handling of personal information is described in the{' '}
            <Link className="text-emerald-700 hover:underline dark:text-emerald-400" href="/privacy">
              Privacy Policy
            </Link>
            , which forms part of these terms.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">9. Suspension and termination</h2>
          <p>
            You may stop using the App at any time by uninstalling it. We may suspend or terminate
            access if these terms are breached, if required by law, or if your use threatens the
            security or stability of the service.
          </p>
          <p>
            On uninstall, your access token is revoked immediately and your data is deleted in line
            with the retention periods in the Privacy Policy. Export anything you wish to keep before
            uninstalling.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">10. Disclaimers</h2>
          <p>
            The App is provided on an &quot;as is&quot; and &quot;as available&quot; basis, without
            warranties of any kind to the fullest extent permitted by law. We do not warrant that the
            App will be error-free, or that it will increase your sales or conversion rate.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">11. Limitation of liability</h2>
          <p>
            To the fullest extent permitted by law, we are not liable for indirect, incidental or
            consequential losses, including lost profits, lost revenue or lost data. Our total
            liability arising out of these terms is limited to the amount you paid for the App in the
            twelve months preceding the claim.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">12. Changes to these terms</h2>
          <p>
            We may update these terms. Material changes will be communicated to installed merchants.
            Continuing to use the App after a change takes effect constitutes acceptance.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">13. Contact</h2>
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
