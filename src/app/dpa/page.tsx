import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Data Processing Agreement — ReviewMaster',
  description:
    'The data processing terms between ReviewMaster and merchants who install it, covering GDPR Article 28, international transfers, sub-processors and US state privacy law.',
};

const LAST_UPDATED = '1 August 2026';
const CONTACT_EMAIL = 'tech@houseofmarka.com';
const LEGAL_ENTITY = 'Marka Modern Retail Private Limited';

export default function DataProcessingAgreement() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-slate-800 dark:text-slate-200">
      <Link href="/" className="text-sm text-emerald-700 hover:underline dark:text-emerald-400">
        &larr; Back to ReviewMaster
      </Link>

      <h1 className="mt-6 text-3xl font-bold tracking-tight">Data Processing Agreement</h1>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Last updated: {LAST_UPDATED}</p>

      <div className="prose prose-slate dark:prose-invert mt-8 max-w-none space-y-6 text-[15px] leading-relaxed">

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900">
          <p className="!mt-0 text-sm">
            This agreement forms part of the{' '}
            <Link href="/terms" className="text-emerald-700 hover:underline dark:text-emerald-400">Terms of Service</Link>{' '}
            and takes effect automatically when you install ReviewMaster. No signature is
            required. It governs personal data belonging to <em>your customers</em> that the
            App processes on your behalf. How we handle <em>your own</em> merchant account
            data is described in the{' '}
            <Link href="/privacy" className="text-emerald-700 hover:underline dark:text-emerald-400">Privacy Policy</Link>.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">1. Parties and roles</h2>
          <p>
            This agreement is between <strong>{LEGAL_ENTITY}</strong> (&quot;we&quot;,
            &quot;us&quot;, the &quot;Processor&quot;), which operates the ReviewMaster
            application, and the merchant who installs it (&quot;you&quot;, the
            &quot;Controller&quot;).
          </p>
          <p>
            You decide why and how your customers&apos; personal data is processed. We act
            only on your instructions. Installing the App, configuring it, and using its
            features constitute your documented instructions for the purposes of Article
            28(3)(a) of the UK and EU General Data Protection Regulation.
          </p>
          <p>
            Where we determine our own purposes — for example, keeping records of who has
            asked never to be emailed again — we act as a controller for that limited
            processing and say so explicitly in section 7.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">2. Scope of processing</h2>
          <p><strong>Subject matter.</strong> Collecting, storing and displaying product reviews for your store, and inviting your customers to leave them.</p>
          <p><strong>Duration.</strong> For as long as the App is installed, plus the deletion window in section 8.</p>
          <p><strong>Nature and purpose.</strong> Receiving order data from Shopify when an order is fulfilled; sending one review invitation per order; matching a submitted review to that order so it can be shown as a verified purchase; storing and publishing review content on your storefront.</p>
          <p><strong>Categories of data subject.</strong> Your customers who have completed a purchase, and visitors to your storefront who submit or interact with a review.</p>
          <p><strong>Categories of personal data.</strong></p>
          <ul className="list-disc pl-6">
            <li>Customer name (first and last), from the order</li>
            <li>Customer email address, from the order</li>
            <li>Order identifier and the products it contained</li>
            <li>Review content submitted by the customer, including any photograph or video they choose to attach, and the display name and location they choose to publish</li>
            <li>For a limited period, the IP address and browser user agent recorded against storefront events, used to detect abuse</li>
          </ul>
          <p>
            <strong>No special category data.</strong> The App does not request, and has no
            use for, data revealing health, ethnicity, religion, political opinion, trade
            union membership, sexual orientation, biometrics or genetics. It does not process
            children&apos;s data knowingly. Review content is free text, so a customer could
            in principle write anything into it; that is content you control and moderate,
            and we do not analyse it for such characteristics.
          </p>
          <p>
            <strong>Data minimisation in practice.</strong> We hold Shopify approval to read
            only the customer <em>name</em> and <em>email</em> fields. Phone numbers and
            postal addresses are not requested, and Shopify redacts them from every API
            response we receive.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">3. Our obligations</h2>
          <ul className="list-disc pl-6">
            <li><strong>Instructions.</strong> We process personal data only on your documented instructions, including for transfers, unless required otherwise by law — in which case we will tell you before processing, unless the law forbids us from doing so.</li>
            <li><strong>Confidentiality.</strong> Everyone we authorise to access personal data is bound by a duty of confidentiality.</li>
            <li><strong>Security.</strong> We implement the technical and organisational measures set out in Annex&nbsp;2, as required by Article 32.</li>
            <li><strong>Sub-processors.</strong> Engaged only under section 5.</li>
            <li><strong>Data subject rights.</strong> We assist you in responding to requests, as described in section 6.</li>
            <li><strong>Breach.</strong> We notify you without undue delay, as described in section 9.</li>
            <li><strong>Impact assessments.</strong> We provide reasonable assistance with data protection impact assessments and prior consultations, taking into account the information available to us.</li>
            <li><strong>Deletion.</strong> We delete or return personal data at the end of the relationship, as described in section 8.</li>
            <li><strong>Demonstrating compliance.</strong> We make available the information needed to show these obligations are met, as described in section 10.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold">4. Your obligations</h2>
          <p>
            You confirm that you have a lawful basis for the processing you instruct, that
            your own privacy notice tells your customers their data may be shared with a
            review provider, and that you have obtained any consent your jurisdiction
            requires before a review invitation is sent.
          </p>
          <p>
            This matters in practice. A post-purchase review invitation is treated as
            transactional in most jurisdictions, but not all, and you are closer than we are
            to knowing where your customers live and what you told them at checkout.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">5. Sub-processors</h2>
          <p>
            You give general authorisation for us to engage sub-processors. The current list
            is published at{' '}
            <Link href="/subprocessors" className="text-emerald-700 hover:underline dark:text-emerald-400">/subprocessors</Link>{' '}
            and forms part of this agreement.
          </p>
          <p>
            Before adding or replacing a sub-processor we will update that page and give at
            least <strong>30 days&apos; notice</strong> by email to the address on your
            account. If you object on reasonable data protection grounds within that period,
            tell us and we will either propose an alternative or, if we cannot, you may
            terminate by uninstalling the App without penalty.
          </p>
          <p>
            Each sub-processor is bound by written terms offering protections materially
            equivalent to those in this agreement. We remain fully liable to you for their
            performance.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">6. Assisting with data subject rights</h2>
          <p>
            Most requests are handled automatically. Shopify sends us the mandatory{' '}
            <code>customers/data_request</code> and <code>customers/redact</code> webhooks
            when your customer exercises their rights through you, and the App answers them
            without either of us having to act.
          </p>
          <p>
            On receiving <code>customers/redact</code> we erase that customer&apos;s reviews,
            questions, review requests, incentive grants and analytics events. Where a
            request reaches us directly rather than through you, we will refer the individual
            to you, and tell you, rather than acting unilaterally on a controller&apos;s
            behalf.
          </p>
          <p>
            One exception is deliberate. If an address is on our suppression list because it
            bounced permanently or the recipient reported a message as spam, erasure removes
            everything else but retains the address itself. See section 7.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">7. Suppression list — where we act as controller</h2>
          <p>
            We keep a platform-wide list of email addresses that must never be contacted
            again: permanent bounces, and anyone who has marked a message as spam or used the
            unsubscribe link.
          </p>
          <p>
            We are the controller for that list, on the legitimate-interest basis of honouring
            an objection to being contacted and of protecting the deliverability every
            merchant on the platform shares. It holds the address and the reason, and nothing
            else. Deleting an entry would mean emailing again someone who has already asked us
            not to — so the suppression outlives the data it protects, and that is the point
            of it.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">8. Retention and deletion</h2>
          <p>Personal data is not kept longer than it is needed:</p>
          <ul className="list-disc pl-6">
            <li><strong>Review invitations</strong> — the customer&apos;s name and email are erased from the invitation record 30 days after the invitation link expires. The record itself is kept, without those details, so the same order can never trigger a second invitation, and is deleted entirely after 24 months.</li>
            <li><strong>Storefront analytics</strong> — IP address and user agent are cleared after 30 days; the event is deleted after 180 days.</li>
            <li><strong>Reviews</strong> — kept while the App is installed, because they are your content and your customers&apos; published words. The reviewer&apos;s email is retained alongside so that a &quot;verified purchase&quot; badge remains auditable.</li>
          </ul>
          <p>
            On uninstall, Shopify sends <code>shop/redact</code> 48 hours later and we erase
            your store&apos;s data in full. If you need an export first, ask before
            uninstalling. Backups are encrypted and expire on their own schedule within
            35 days; we do not restore a backup to satisfy a deletion request, and deleted
            data does not return to service.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">9. Personal data breach</h2>
          <p>
            We notify you <strong>without undue delay and in any case within 48 hours</strong>{' '}
            of becoming aware of a personal data breach affecting your customers&apos; data,
            by email to the address on your account.
          </p>
          <p>
            The notification will describe what happened, which categories and approximate
            numbers of records are affected, the likely consequences, what we have done and
            what we recommend you do. Where the full picture is not yet available we will send
            what we have and follow up rather than waiting. The statutory 72-hour clock for
            notifying your supervisory authority is yours, which is why ours is shorter.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">10. Audit</h2>
          <p>
            On reasonable written request, and no more than once a year unless a breach or a
            regulator requires otherwise, we will provide the information reasonably necessary
            to demonstrate compliance with this agreement — including completing a security
            questionnaire and providing a written description of our measures.
          </p>
          <p>
            We are a small team and do not offer on-site inspection by default. Where a
            regulator requires more, we will cooperate in good faith to find a proportionate
            way to give it.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">11. International transfers</h2>
          <p>
            We are established in India. The App runs on Microsoft Azure in the United States
            and sends email through Amazon SES in the United States. Personal data belonging
            to customers in the EEA, the UK or Switzerland is therefore transferred outside
            those territories.
          </p>
          <p>Those transfers rely on:</p>
          <ul className="list-disc pl-6">
            <li>the European Commission&apos;s <strong>Standard Contractual Clauses</strong> (Decision 2021/914), Module Three (processor to sub-processor) or Module Two (controller to processor) as applicable, which are incorporated into this agreement by reference and take precedence over it in the event of conflict;</li>
            <li>the <strong>UK International Data Transfer Addendum</strong> (version B1.0) for transfers subject to UK GDPR;</li>
            <li>the Swiss addendum, reading references to the GDPR as references to the Swiss FADP and to the supervisory authority as the FDPIC, for transfers subject to Swiss law.</li>
          </ul>
          <p>
            Where the Clauses require a choice, the parties select: docking clause applies;
            general authorisation for sub-processors with 30 days&apos; notice; governing law
            and forum, Ireland. We have assessed the transfers and apply the measures in
            Annex&nbsp;2 — in particular encryption in transit and at rest — as supplementary
            protections.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">12. United States state privacy laws</h2>
          <p>
            For personal information subject to the California Consumer Privacy Act as amended
            by the CPRA, and to comparable laws in Virginia, Colorado, Connecticut, Utah and
            other states, we act as a <strong>service provider</strong> (or
            &quot;processor&quot;, as those laws term it).
          </p>
          <p>We certify that we:</p>
          <ul className="list-disc pl-6">
            <li>do not sell or share personal information, and never have;</li>
            <li>do not retain, use or disclose it for any purpose other than performing the services in this agreement, and specifically not for a commercial purpose of our own;</li>
            <li>do not combine it with personal information received from other sources, except as those laws permit;</li>
            <li>do not use it for cross-context behavioural advertising;</li>
            <li>and understand these restrictions and will comply with them.</li>
          </ul>
          <p>
            We do not train machine learning models on your customers&apos; personal data or
            on review content, and we do not use either to improve the App for other merchants.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">13. Other laws</h2>
          <p>
            As an Indian entity we are also subject to the <strong>Digital Personal Data
            Protection Act, 2023</strong>, under which we act as a Data Processor engaged by
            you. Where its obligations exceed those set out above, we meet them.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">14. Term, changes and precedence</h2>
          <p>
            This agreement runs for as long as we process personal data on your behalf.
            Sections 7 to 12 survive its termination to the extent needed.
          </p>
          <p>
            We may update it to reflect changes in law or in how the App works. Material
            changes are announced by email and by updating the date at the top, at least 30
            days before they take effect. Continuing to use the App after that constitutes
            acceptance; if you do not accept, uninstall before the date.
          </p>
          <p>
            In the event of conflict, the Standard Contractual Clauses take precedence over
            this agreement, and this agreement takes precedence over the Terms of Service, in
            each case only as to the processing of your customers&apos; personal data.
          </p>
        </section>

        <hr className="border-slate-200 dark:border-slate-700" />

        <section>
          <h2 className="text-xl font-semibold">Annex 1 — Processing details</h2>
          <p>
            The categories of data subject, categories of personal data, nature, purpose and
            duration of processing are those set out in section 2. This annex serves as
            Annex&nbsp;I to the Standard Contractual Clauses. The competent supervisory
            authority is that of the member state in which you, as exporter, are established.
          </p>
          <p>
            <strong>Frequency of transfer:</strong> continuous, on an event-driven basis as
            orders are fulfilled and reviews submitted.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">Annex 2 — Technical and organisational measures</h2>
          <p>This annex serves as Annex&nbsp;II to the Standard Contractual Clauses.</p>
          <ul className="list-disc pl-6">
            <li><strong>Encryption in transit.</strong> HTTPS is enforced on every endpoint. The database requires TLS and refuses unencrypted connections.</li>
            <li><strong>Encryption at rest.</strong> Database storage and backups are encrypted by the platform. The Shopify access token for each store is additionally encrypted at the application layer, so a database disclosure alone does not yield access to merchant stores.</li>
            <li><strong>Access control.</strong> Access to production systems is limited to named individuals who require it, protected by strong passwords and multi-factor authentication. Database network access is restricted by firewall rules.</li>
            <li><strong>Authentication.</strong> Merchant sessions use short-lived Shopify App Bridge session tokens, verified by signature on every request.</li>
            <li><strong>Tenant isolation.</strong> Every query is scoped to the requesting store, and ownership is asserted server-side rather than trusted from the client, so one merchant&apos;s data cannot be reached from another&apos;s session.</li>
            <li><strong>Webhook authenticity.</strong> Every inbound Shopify webhook is HMAC-verified before it is acted upon; SNS notifications are verified against the published certificate.</li>
            <li><strong>Environment separation.</strong> Development and test data are held separately from production data.</li>
            <li><strong>Logging.</strong> Access to the production database is logged, along with application-level authentication events.</li>
            <li><strong>Retention.</strong> Enforced automatically by a scheduled job, not by manual review — see section 8.</li>
            <li><strong>Incident response.</strong> A written policy defines severity, roles, containment, evidence handling and notification timelines.</li>
            <li><strong>Data loss prevention.</strong> A written strategy governs where personal data may be copied, how exports are handled, and what is prohibited.</li>
            <li><strong>Backups.</strong> Automated, encrypted, retained for 35 days, and never restored into a non-production environment.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold">Contact</h2>
          <p>
            Data protection enquiries, sub-processor objections and breach correspondence:{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-emerald-700 hover:underline dark:text-emerald-400">{CONTACT_EMAIL}</a>.
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            If your organisation requires this agreement on its own paper, or a signed copy,
            write to the address above.
          </p>
        </section>
      </div>
    </main>
  );
}
