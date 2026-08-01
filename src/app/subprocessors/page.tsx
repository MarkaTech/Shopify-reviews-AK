import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Sub-processors — ReviewMaster',
  description:
    'The third parties ReviewMaster uses to process merchant customer data, what each one does, and where it is located.',
};

const LAST_UPDATED = '1 August 2026';
const CONTACT_EMAIL = 'tech@houseofmarka.com';

interface SubProcessor {
  name: string;
  entity: string;
  purpose: string;
  data: string;
  location: string;
}

/**
 * Kept deliberately short. Every entry is a party that can see personal data, and a list
 * that grows without a reason attached to each line stops being a control.
 */
const SUBPROCESSORS: SubProcessor[] = [
  {
    name: 'Microsoft Azure',
    entity: 'Microsoft Corporation',
    purpose: 'Application hosting, PostgreSQL database, encrypted backups',
    data: 'All data the App holds: reviews, review invitations, storefront analytics',
    location: 'United States (Central US)',
  },
  {
    name: 'Amazon SES',
    entity: 'Amazon Web Services, Inc.',
    purpose: 'Delivery of review invitations and merchant notification email',
    data: 'Recipient name and email address, message content',
    location: 'United States (us-east-1)',
  },
];

export default function SubProcessors() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-slate-800 dark:text-slate-200">
      <Link href="/" className="text-sm text-emerald-700 hover:underline dark:text-emerald-400">
        &larr; Back to ReviewMaster
      </Link>

      <h1 className="mt-6 text-3xl font-bold tracking-tight">Sub-processors</h1>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Last updated: {LAST_UPDATED}</p>

      <div className="prose prose-slate dark:prose-invert mt-8 max-w-none space-y-6 text-[15px] leading-relaxed">
        <p>
          These are the third parties that process your customers&apos; personal data on our
          behalf. The list forms part of the{' '}
          <Link href="/dpa" className="text-emerald-700 hover:underline dark:text-emerald-400">Data Processing Agreement</Link>,
          and we give at least <strong>30 days&apos; notice</strong> before adding to it.
        </p>

        <div className="not-prose overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900">
              <tr>
                <th className="px-4 py-3 font-semibold">Sub-processor</th>
                <th className="px-4 py-3 font-semibold">Purpose</th>
                <th className="px-4 py-3 font-semibold">Data</th>
                <th className="px-4 py-3 font-semibold">Location</th>
              </tr>
            </thead>
            <tbody>
              {SUBPROCESSORS.map((sp) => (
                <tr key={sp.name} className="border-t border-slate-200 align-top dark:border-slate-700">
                  <td className="px-4 py-3">
                    <div className="font-medium">{sp.name}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{sp.entity}</div>
                  </td>
                  <td className="px-4 py-3">{sp.purpose}</td>
                  <td className="px-4 py-3">{sp.data}</td>
                  <td className="px-4 py-3">{sp.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <section>
          <h2 className="text-xl font-semibold">Not sub-processors</h2>
          <p>
            Two things people reasonably expect to see here, and why they are absent:
          </p>
          <ul className="list-disc pl-6">
            <li>
              <strong>Shopify.</strong> Shopify is where your customers&apos; data originates
              and is your own processor under your agreement with them. It is not engaged by
              us.
            </li>
            <li>
              <strong>Review photos and video.</strong> These are uploaded into{' '}
              <em>your own</em> Shopify Files, not into storage of ours, so they never leave
              your Shopify account and no third party of ours can reach them.
            </li>
          </ul>
          <p>
            Our source control and deployment tooling is excluded because it never receives
            personal data — no production data is copied into it, and it holds only
            application code.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">Objecting</h2>
          <p>
            If you object to a new sub-processor on reasonable data protection grounds, write
            to{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-emerald-700 hover:underline dark:text-emerald-400">{CONTACT_EMAIL}</a>{' '}
            within the notice period. We will propose an alternative where one exists, and
            where none does you may uninstall without penalty.
          </p>
        </section>
      </div>
    </main>
  );
}
