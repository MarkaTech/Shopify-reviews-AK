import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Data Processing Agreement — ReviewMaster',
  description: 'The data processing terms that apply when ReviewMaster processes customer personal data on behalf of a Shopify merchant.',
};

const LAST_UPDATED = '20 August 2026';
const CONTACT_EMAIL = 'tech@houseofmarka.com';

/*
 * This page is the binding version of the DPA. It was finalised from the 20 August 2026
 * draft: the data importer's registered address filled in (Annex 1), the technical-data
 * description aligned with the production implementation stated in the Privacy Policy
 * (no persisted raw IP), and the draft's editorial verification annex resolved and removed.
 * Substantive edits belong here first — PDF copies are exports of this page, not the
 * other way round.
 */

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-10 text-xl font-semibold">{children}</h2>;
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-6 text-base font-semibold">{children}</h3>;
}

export default function Dpa() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-slate-800 dark:text-slate-200">
      <Link href="/" className="text-sm text-emerald-700 hover:underline dark:text-emerald-400">
        &larr; Back to ReviewMaster
      </Link>

      <h1 className="mt-6 text-3xl font-bold tracking-tight">
        ReviewMaster Data Processing Agreement
      </h1>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Last updated: {LAST_UPDATED}</p>

      <div className="prose prose-slate dark:prose-invert mt-8 max-w-none space-y-4 text-[15px] leading-relaxed">
        <p>
          This Data Processing Agreement (&ldquo;<strong>DPA</strong>&rdquo;) forms part of the
          ReviewMaster <Link href="/terms">Terms of Service</Link> between:
        </p>
        <p>
          <strong>Marka Modern Retail Private Limited</strong>, operator of ReviewMaster,
          established in India (&ldquo;<strong>Processor</strong>&rdquo;,
          &ldquo;<strong>ReviewMaster</strong>&rdquo;, &ldquo;<strong>Marka</strong>&rdquo;,
          &ldquo;<strong>we</strong>&rdquo;, &ldquo;<strong>us</strong>&rdquo;);
        </p>
        <p>and</p>
        <p>
          the Shopify merchant that installs or uses ReviewMaster
          (&ldquo;<strong>Controller</strong>&rdquo;, &ldquo;<strong>Merchant</strong>&rdquo;,
          &ldquo;<strong>you</strong>&rdquo;).
        </p>
        <p>
          This DPA applies automatically where ReviewMaster processes Customer Personal Data on
          the Merchant&rsquo;s behalf.
        </p>
        <p>No separate signature is required unless Applicable Law requires otherwise.</p>

        <H>1. Definitions</H>
        <p>For this DPA:</p>
        <ul className="list-disc pl-6">
          <li>
            <strong>Applicable Data Protection Law</strong> means privacy and data-protection law
            applicable to the Processing, including where applicable the EU GDPR, UK GDPR and laws
            implementing or supplementing them.
          </li>
          <li>
            <strong>Controller</strong>, <strong>Processor</strong>, <strong>Data Subject</strong>,{' '}
            <strong>Personal Data</strong>, <strong>Processing</strong>,{' '}
            <strong>Personal Data Breach</strong>, and <strong>Supervisory Authority</strong> have
            the meanings given under Applicable Data Protection Law.
          </li>
          <li>
            <strong>Customer Personal Data</strong> means Personal Data processed by ReviewMaster
            on behalf of the Merchant through ReviewMaster.
          </li>
          <li>
            <strong>Subprocessor</strong> means a third party engaged by ReviewMaster to Process
            Customer Personal Data on behalf of the Merchant.
          </li>
          <li>
            <strong>SCCs</strong> means the European Commission Standard Contractual Clauses
            adopted by Commission Implementing Decision (EU) 2021/914, as amended or replaced.
          </li>
          <li>
            <strong>UK Addendum</strong> means the then-current legally recognized UK addendum
            applicable to the EU SCCs or any successor mechanism.
          </li>
        </ul>

        <H>2. Roles</H>
        <p>For Customer Personal Data governed by this DPA:</p>
        <ul className="list-disc pl-6">
          <li>the Merchant is the Controller or acts on behalf of the relevant Controller;</li>
          <li>ReviewMaster is the Processor.</li>
        </ul>
        <p>
          The Merchant determines the purposes for which Customer Personal Data is processed
          through enabled ReviewMaster functionality.
        </p>
        <p>ReviewMaster processes Customer Personal Data only:</p>
        <ul className="list-disc pl-6">
          <li>on documented instructions from the Merchant;</li>
          <li>as necessary to provide ReviewMaster;</li>
          <li>as required by Applicable Law.</li>
        </ul>
        <p>
          Installing ReviewMaster, selecting settings, enabling integrations, activating
          communications, issuing instructions through the dashboard and otherwise using
          ReviewMaster constitute documented instructions.
        </p>
        <p>
          If ReviewMaster is required by law to Process Customer Personal Data other than on the
          Merchant&rsquo;s instructions, we will inform the Merchant before Processing unless
          Applicable Law prohibits that notice.
        </p>
        <p>
          ReviewMaster will immediately inform the Merchant if, in our reasonable opinion, an
          instruction infringes Applicable Data Protection Law, unless prohibited from doing so.
        </p>

        <H>3. Processing Details</H>
        <p>
          The information required by Article 28(3) GDPR/UK GDPR is described below and in
          Annex 1.
        </p>

        <H3>3.1 Subject matter</H3>
        <p>
          Providing ReviewMaster&rsquo;s product-review, review-request, moderation, display,
          verification, questions-and-answers, analytics, incentive and enabled review-integration
          functionality.
        </p>

        <H3>3.2 Duration</H3>
        <p>
          For the period during which ReviewMaster is installed and used, plus the limited
          deletion and backup periods described in this DPA.
        </p>

        <H3>3.3 Nature and purposes</H3>
        <p>Processing may include:</p>
        <ul className="list-disc pl-6">
          <li>receiving eligible Shopify order information;</li>
          <li>creating review invitations;</li>
          <li>sending initial invitations and follow-up reminders configured by the Merchant;</li>
          <li>associating submitted reviews with eligible purchases;</li>
          <li>determining verified-purchase status;</li>
          <li>storing review information;</li>
          <li>displaying published reviews;</li>
          <li>receiving questions;</li>
          <li>transmitting answers;</li>
          <li>facilitating incentives configured by the Merchant;</li>
          <li>preventing duplicate or abusive submissions;</li>
          <li>calculating review analytics;</li>
          <li>sending Merchant notifications;</li>
          <li>transmitting eligible reviews to integrations enabled by the Merchant;</li>
          <li>providing support;</li>
          <li>performing security and reliability operations.</li>
        </ul>

        <H>4. Merchant Obligations</H>
        <p>The Merchant represents and warrants that:</p>
        <ol className="list-decimal pl-6">
          <li>it has a valid lawful basis for the Processing it instructs;</li>
          <li>it has provided all privacy notices required by Applicable Data Protection Law;</li>
          <li>it has obtained consent wherever consent is legally required;</li>
          <li>it is legally entitled to disclose Customer Personal Data to ReviewMaster;</li>
          <li>its instructions comply with Applicable Data Protection Law;</li>
          <li>
            its use of review invitations, reminders and incentives complies with applicable
            privacy, consumer-protection and electronic-marketing laws;
          </li>
          <li>
            it will not instruct ReviewMaster to collect or use Personal Data that is unnecessary
            for ReviewMaster&rsquo;s functions;
          </li>
          <li>
            it will not intentionally use ReviewMaster to solicit special-category/sensitive
            Personal Data unless the parties have expressly agreed appropriate safeguards
            beforehand.
          </li>
        </ol>
        <p>
          The Merchant remains responsible for the accuracy, quality, legality and lawful
          acquisition of Customer Personal Data supplied to ReviewMaster.
        </p>
        <p>
          The legal classification of a review invitation or reminder varies by jurisdiction and
          content. ReviewMaster does not warrant that such communications are universally
          transactional or exempt from marketing law.
        </p>

        <H>5. ReviewMaster Processor Obligations</H>
        <p>ReviewMaster will:</p>
        <ol className="list-decimal pl-6">
          <li>
            process Customer Personal Data only on documented instructions, except where legally
            required otherwise;
          </li>
          <li>
            ensure persons authorized to Process Customer Personal Data are subject to
            confidentiality obligations;
          </li>
          <li>maintain appropriate technical and organizational security measures;</li>
          <li>engage Subprocessors only in accordance with Section 9;</li>
          <li>reasonably assist the Merchant with Data Subject requests;</li>
          <li>
            provide reasonable assistance with the Merchant&rsquo;s security,
            breach-notification, data-protection impact assessment and prior-consultation
            obligations, taking into account the nature of Processing and information available
            to ReviewMaster;
          </li>
          <li>
            delete or return Customer Personal Data at the end of Processing as described in
            Section 11;
          </li>
          <li>
            provide information reasonably necessary to demonstrate compliance with applicable
            Article 28-type obligations;
          </li>
          <li>allow audits and inspections subject to the reasonable protections in Section 13.</li>
        </ol>

        <H>6. Categories of Data Subjects</H>
        <p>Customer Personal Data may relate to:</p>
        <ul className="list-disc pl-6">
          <li>customers who purchased products from the Merchant;</li>
          <li>persons invited to submit reviews;</li>
          <li>persons who submit reviews;</li>
          <li>storefront visitors who submit questions;</li>
          <li>storefront visitors interacting with review functionality;</li>
          <li>persons whose information appears in user-generated review content.</li>
        </ul>

        <H>7. Categories of Personal Data</H>
        <p>Depending on the Merchant&rsquo;s configuration, Customer Personal Data may include:</p>

        <H3>Identity/contact</H3>
        <ul className="list-disc pl-6">
          <li>customer/reviewer name;</li>
          <li>display name;</li>
          <li>email address;</li>
          <li>optional reviewer-supplied or Merchant-supplied location.</li>
        </ul>

        <H3>Transaction information</H3>
        <ul className="list-disc pl-6">
          <li>Shopify order identifier;</li>
          <li>order number;</li>
          <li>fulfillment status;</li>
          <li>purchased product information;</li>
          <li>information necessary to verify an eligible purchase.</li>
        </ul>

        <H3>Review data</H3>
        <ul className="list-disc pl-6">
          <li>rating;</li>
          <li>title;</li>
          <li>review text;</li>
          <li>submission date;</li>
          <li>verification status;</li>
          <li>incentive status;</li>
          <li>review source;</li>
          <li>Merchant reply.</li>
        </ul>

        <H3>Media</H3>
        <ul className="list-disc pl-6">
          <li>customer-submitted photographs or videos;</li>
          <li>associated URLs and metadata.</li>
        </ul>
        <p>
          Where media is uploaded to Shopify Files, Shopify stores the underlying media for the
          Merchant and ReviewMaster may retain related URLs or metadata.
        </p>

        <H3>Questions and answers</H3>
        <ul className="list-disc pl-6">
          <li>questioner&rsquo;s name;</li>
          <li>email where provided;</li>
          <li>question;</li>
          <li>Merchant answer;</li>
          <li>product association.</li>
        </ul>

        <H3>Incentives</H3>
        <ul className="list-disc pl-6">
          <li>customer email;</li>
          <li>discount-code identifier;</li>
          <li>issuance status;</li>
          <li>expiry information.</li>
        </ul>

        <H3>Limited technical data</H3>
        <p>Where required for security, abuse-prevention or operational analytics:</p>
        <ul className="list-disc pl-6">
          <li>IP address or limited representation of an IP address;</li>
          <li>browser user-agent;</li>
          <li>timestamp;</li>
          <li>request/event metadata.</li>
        </ul>
        <p>
          Raw shopper IP addresses are not persistently stored. Where used for abuse prevention,
          an IP address may be transformed into a non-reversible or limited-purpose value, as
          described in the ReviewMaster <Link href="/privacy">Privacy Policy</Link>.
        </p>

        <H>8. Special-Category and Sensitive Data</H>
        <p>
          ReviewMaster does <strong>not intentionally request or solicit</strong> special-category
          Personal Data, including information concerning:
        </p>
        <ul className="list-disc pl-6">
          <li>health;</li>
          <li>ethnicity or race;</li>
          <li>political opinions;</li>
          <li>religious or philosophical beliefs;</li>
          <li>trade-union membership;</li>
          <li>genetics;</li>
          <li>biometrics used for unique identification;</li>
          <li>sex life;</li>
          <li>sexual orientation.</li>
        </ul>
        <p>
          However, reviews, questions and uploaded media are user-generated content. A Data
          Subject may voluntarily include sensitive information.
        </p>
        <p>
          The Merchant must not intentionally solicit unnecessary special-category or sensitive
          Personal Data through ReviewMaster.
        </p>
        <p>
          If ReviewMaster becomes aware of such information, we may take reasonable steps to
          restrict or delete it where appropriate and legally permitted.
        </p>

        <H>9. Subprocessors</H>
        <p>
          The Merchant gives ReviewMaster <strong>general written authorization</strong> to engage
          Subprocessors.
        </p>
        <p>The current Subprocessor List is maintained at:</p>
        <p>
          <strong>
            <Link href="/subprocessors">
              https://reviewmaster-app.azurewebsites.net/subprocessors
            </Link>
          </strong>
        </p>
        <p>That list forms part of this DPA.</p>
        <p>
          ReviewMaster will ensure each Subprocessor that Processes Customer Personal Data is
          subject to written data-protection obligations that provide a level of protection
          appropriate to the Processing and materially consistent with ReviewMaster&rsquo;s
          applicable obligations under this DPA.
        </p>
        <p>
          ReviewMaster remains responsible for its Subprocessors to the extent required by
          Applicable Data Protection Law.
        </p>

        <H3>9.1 Changes to Subprocessors</H3>
        <p>
          ReviewMaster will provide at least <strong>30 days&rsquo; prior notice</strong> of a new
          or replacement Subprocessor that will materially Process Customer Personal Data, unless
          an urgent change is reasonably required to address a security incident, legal
          requirement or service continuity issue.
        </p>
        <p>
          The Merchant may object during the notice period on reasonable, documented
          data-protection grounds.
        </p>
        <p>The Merchant may not object solely for commercial or competitive reasons.</p>
        <p>If:</p>
        <ul className="list-disc pl-6">
          <li>the objection is reasonable;</li>
          <li>the parties cannot resolve it;</li>
          <li>
            ReviewMaster cannot reasonably provide the relevant functionality without the
            Subprocessor,
          </li>
        </ul>
        <p>
          the Merchant&rsquo;s sole remedy in relation to that Subprocessor change is to
          discontinue the affected functionality or terminate ReviewMaster without penalty for
          future subscription periods.
        </p>

        <H>10. Data Subject Requests</H>
        <p>
          Taking into account the nature of Processing, ReviewMaster will provide reasonable
          assistance to enable the Merchant to respond to Data Subject rights requests.
        </p>
        <p>
          Where Shopify provides an applicable privacy webhook or other approved mechanism,
          ReviewMaster may use that mechanism to process the request.
        </p>
        <p>
          If ReviewMaster receives a request directly from a Customer concerning Customer Personal
          Data Processed on behalf of a Merchant, ReviewMaster will ordinarily:
        </p>
        <ol className="list-decimal pl-6">
          <li>identify the relevant Merchant where reasonably possible;</li>
          <li>inform the requester that the Merchant controls the relevant Processing;</li>
          <li>refer or forward the request to the Merchant where appropriate;</li>
          <li>
            avoid independently responding substantively except where instructed by the Merchant
            or required by law.
          </li>
        </ol>
        <p>
          Nothing prevents ReviewMaster from acting directly where Marka independently acts as
          controller for a particular category of Personal Data.
        </p>

        <H>11. Return, Export and Deletion</H>
        <p>
          At the end of the Processing relationship, and subject to Applicable Law, ReviewMaster
          will at the Merchant&rsquo;s choice <strong>delete or return</strong> Customer Personal
          Data.
        </p>
        <p>
          Because Shopify uninstall may rapidly revoke ReviewMaster&rsquo;s access to the store,
          the Merchant should use available export functionality or request an export{' '}
          <strong>before uninstalling</strong> where the Merchant wishes to retain a copy.
        </p>
        <p>
          Where an export is reasonably available before termination, providing that export
          satisfies the &ldquo;return&rdquo; option.
        </p>
        <p>Following termination/uninstall:</p>
        <ul className="list-disc pl-6">
          <li>
            credentials permitting access to the Merchant store will be deleted, revoked or
            rendered unusable;
          </li>
          <li>
            Customer Personal Data in ReviewMaster&rsquo;s active systems will be deleted in
            accordance with Shopify requirements and Applicable Law;
          </li>
          <li>
            originals, copies and reproductions of Shopify Merchant Data will be deleted within
            the period required by Shopify, and in any event ordinarily substantially earlier
            through the applicable redaction flow;
          </li>
          <li>
            residual copies contained solely in encrypted backups will be placed beyond active use
            and automatically deleted or overwritten within no more than <strong>28 days</strong>{' '}
            after the relevant production deletion.
          </li>
        </ul>
        <p>
          ReviewMaster may retain information where required by Applicable Law, provided that such
          retained information remains appropriately protected and is not used for unrelated
          purposes.
        </p>

        <H>12. Customer Deletion and Anonymization</H>
        <p>
          ReviewMaster will not assume that review text becomes anonymous merely because the
          reviewer&rsquo;s name or email address has been removed.
        </p>
        <p>Where a valid deletion/redaction instruction applies:</p>
        <ul className="list-disc pl-6">
          <li>direct identifiers will be deleted or anonymized;</li>
          <li>
            associated requests, incentive information and applicable Customer records will be
            deleted where required;
          </li>
          <li>
            free-text content, media or other fields that independently identify the Customer will
            also be deleted or irreversibly anonymized where required by Applicable Data
            Protection Law and the Merchant&rsquo;s lawful instructions.
          </li>
        </ul>
        <p>A review may be retained only where:</p>
        <ul className="list-disc pl-6">
          <li>the Merchant lawfully instructs retention;</li>
          <li>the content has been genuinely and irreversibly anonymized; or</li>
          <li>Applicable Law independently permits or requires retention.</li>
        </ul>
        <p>
          Marka may separately retain an applicable suppression record where Marka acts as
          controller and retention is necessary to ensure an opted-out address is not contacted
          again.
        </p>

        <H>13. Audits and Demonstration of Compliance</H>
        <p>
          On reasonable written request, ReviewMaster will make available information reasonably
          necessary to demonstrate compliance with applicable processor obligations.
        </p>
        <p>ReviewMaster may satisfy audit-information requests initially through:</p>
        <ul className="list-disc pl-6">
          <li>security documentation;</li>
          <li>questionnaires;</li>
          <li>applicable policies;</li>
          <li>available certifications;</li>
          <li>independent reports;</li>
          <li>written descriptions of safeguards.</li>
        </ul>
        <p>
          The Merchant may conduct an audit or appoint an independent auditor where reasonably
          necessary.
        </p>
        <p>
          Except where a regulator, Personal Data Breach or credible material non-compliance
          reasonably requires otherwise:
        </p>
        <ul className="list-disc pl-6">
          <li>audits may occur no more than once in any 12-month period;</li>
          <li>at least 30 days&rsquo; written notice must be provided;</li>
          <li>audits must occur during normal business hours;</li>
          <li>the audit must not unreasonably interfere with ReviewMaster operations;</li>
          <li>the auditor must not be a direct competitor of ReviewMaster;</li>
          <li>the auditor must sign reasonable confidentiality obligations;</li>
          <li>the audit must not access another Merchant&rsquo;s data;</li>
          <li>
            ReviewMaster may restrict access to information that would create material security
            risk.
          </li>
        </ul>
        <p>The Merchant bears its own audit costs.</p>
        <p>
          Where an audit imposes substantial assistance requirements beyond ReviewMaster&rsquo;s
          ordinary compliance obligations, ReviewMaster may charge reasonable documented
          assistance costs unless the audit establishes ReviewMaster&rsquo;s material breach of
          this DPA.
        </p>
        <p>Nothing in this section limits a Supervisory Authority&rsquo;s lawful powers.</p>

        <H>14. Security</H>
        <p>
          ReviewMaster maintains technical and organizational measures designed to provide a level
          of security appropriate to the risk.
        </p>
        <p>Measures are described in Annex 2 and may be updated where:</p>
        <ul className="list-disc pl-6">
          <li>security improves;</li>
          <li>technology changes;</li>
          <li>equivalent or better safeguards are adopted.</li>
        </ul>
        <p>
          ReviewMaster will not materially reduce the overall security of Customer Personal Data
          during the term without reasonable justification.
        </p>

        <H>15. Personal Data Breach</H>
        <p>
          ReviewMaster will notify the Merchant <strong>without undue delay</strong> after
          becoming aware of a Personal Data Breach affecting Customer Personal Data.
        </p>
        <p>We will provide information reasonably available to us, which may include:</p>
        <ul className="list-disc pl-6">
          <li>nature of the breach;</li>
          <li>affected categories of Data Subjects;</li>
          <li>affected categories of Personal Data;</li>
          <li>approximate volume where known;</li>
          <li>likely consequences;</li>
          <li>measures taken or proposed;</li>
          <li>contact information for follow-up.</li>
        </ul>
        <p>
          Where all information is not immediately available, ReviewMaster may provide information
          in phases rather than delaying the initial notice.
        </p>
        <p>The Merchant remains responsible for determining whether it must notify:</p>
        <ul className="list-disc pl-6">
          <li>Data Subjects;</li>
          <li>Supervisory Authorities;</li>
          <li>customers;</li>
          <li>other regulators,</li>
        </ul>
        <p>except where ReviewMaster independently has such an obligation.</p>
        <p>
          ReviewMaster maintains a separate incident-response obligation to notify Shopify of
          qualifying actual or suspected compromise of Shopify Merchant Data within
          Shopify&rsquo;s required timeframe.
        </p>

        <H>16. International Transfers</H>
        <p>
          Marka is established in India and ReviewMaster may use infrastructure or Subprocessors
          located outside the country in which Customer Personal Data originated.
        </p>
        <p>
          Current locations and providers are identified in the{' '}
          <Link href="/subprocessors">Subprocessor List</Link>.
        </p>
        <p>
          Where Customer Personal Data protected by EEA transfer restrictions is transferred to a
          recipient in a country requiring a Chapter V GDPR safeguard, the parties agree to use
          the applicable transfer mechanism described below.
        </p>

        <H>17. European Economic Area Transfers</H>
        <p>Where:</p>
        <ul className="list-disc pl-6">
          <li>the Merchant exports Personal Data protected by the EU GDPR;</li>
          <li>ReviewMaster is the data importer;</li>
          <li>the transfer requires an Article 46 GDPR safeguard,</li>
        </ul>
        <p>
          the{' '}
          <strong>
            European Commission Standard Contractual Clauses adopted by Decision (EU) 2021/914
          </strong>{' '}
          are incorporated by reference.
        </p>
        <p>
          For the Merchant-to-ReviewMaster relationship, unless another module is legally more
          appropriate:
        </p>
        <p>
          <strong>Module Two — Controller to Processor</strong> applies.
        </p>
        <p>
          For ReviewMaster-to-Subprocessor transfers requiring SCCs, the applicable
          processor-to-processor mechanism, including <strong>Module Three</strong>, may be used
          between ReviewMaster and the relevant Subprocessor.
        </p>
        <p>For Module Two between Merchant and ReviewMaster:</p>
        <ul className="list-disc pl-6">
          <li>
            the Merchant is the <strong>data exporter</strong>;
          </li>
          <li>
            ReviewMaster is the <strong>data importer</strong>;
          </li>
          <li>Annex 1 of this DPA supplies the processing description to the extent sufficient;</li>
          <li>Annex 2 supplies technical and organizational measures;</li>
          <li>the optional docking clause applies where lawful and useful;</li>
          <li>
            the parties choose the law and Supervisory Authority selections required by the SCCs
            based on the data exporter&rsquo;s circumstances and applicable SCC rules.
          </li>
        </ul>
        <p>
          Where additional selections, party details or annex fields are legally required, those
          required details are deemed completed using the parties&rsquo; current account/contact
          information and the processing information contained in this DPA, to the maximum extent
          legally permitted.
        </p>
        <p>
          If that deeming mechanism is insufficient under Applicable Law, the parties will
          reasonably cooperate to execute the necessary SCC completion page or schedule.
        </p>
        <p>The SCCs prevail over this DPA to the extent of conflict.</p>

        <H>18. United Kingdom Transfers</H>
        <p>
          Where UK GDPR international-transfer restrictions apply and the transfer requires an
          appropriate safeguard, the parties incorporate the legally applicable version of the{' '}
          <strong>
            UK International Data Transfer Addendum to the EU Commission Standard Contractual
            Clauses
          </strong>
          , or a successor mechanism recognized by the UK Information Commissioner&rsquo;s Office.
        </p>
        <p>
          The information in this DPA and its Annexes will populate the Addendum tables to the
          maximum extent legally permitted.
        </p>
        <p>
          Mandatory clauses of the applicable UK transfer instrument prevail in the event of
          conflict.
        </p>

        <H>19. Switzerland and Other Jurisdictions</H>
        <p>
          Where Swiss data-protection law applies to a transfer, the SCCs will be interpreted and
          adapted to the extent legally required to cover Swiss law, including references to
          competent Swiss authorities where necessary.
        </p>
        <p>
          For other countries requiring international-transfer safeguards, the parties will use
          the mechanism required by Applicable Law.
        </p>

        <H>20. Government Requests</H>
        <p>
          Where legally permitted, ReviewMaster will notify the Merchant if ReviewMaster receives
          a binding governmental demand specifically seeking Customer Personal Data Processed on
          the Merchant&rsquo;s behalf.
        </p>
        <p>
          ReviewMaster may challenge or narrow a request where we reasonably believe there are
          lawful grounds to do so.
        </p>
        <p>We will disclose only information reasonably required by the legally binding request.</p>

        <H>21. Data Protection Impact Assessments</H>
        <p>
          Taking into account the nature of Processing and information available to ReviewMaster,
          we will provide reasonable assistance requested by the Merchant in relation to:
        </p>
        <ul className="list-disc pl-6">
          <li>data-protection impact assessments;</li>
          <li>prior consultation with a Supervisory Authority.</li>
        </ul>
        <p>
          ReviewMaster may charge reasonable fees for substantial assistance that is specific to
          the Merchant and materially exceeds ordinary support, unless the assistance is required
          because of ReviewMaster&rsquo;s breach of this DPA.
        </p>

        <H>22. Controller Processing by Marka</H>
        <p>This DPA does not govern processing for which Marka independently acts as controller.</p>
        <p>Examples may include:</p>
        <ul className="list-disc pl-6">
          <li>Merchant business account records;</li>
          <li>security records maintained for Marka&rsquo;s own systems;</li>
          <li>legal/compliance records;</li>
          <li>platform-wide email suppression records.</li>
        </ul>
        <p>
          Such Processing is governed by the ReviewMaster{' '}
          <Link href="/privacy">Privacy Policy</Link> and Applicable Data Protection Law.
        </p>

        <H>23. India Data Protection</H>
        <p>
          ReviewMaster complies with applicable Indian privacy, cybersecurity and data-protection
          requirements.
        </p>
        <p>
          References to the <strong>Digital Personal Data Protection Act, 2023</strong> and
          related rules apply only to the extent and from the dates the relevant provisions are
          legally in force and applicable to ReviewMaster&rsquo;s Processing.
        </p>
        <p>
          Nothing in this DPA represents that provisions not yet commenced have already become
          legally operative.
        </p>

        <H>24. Liability</H>
        <p>
          Liability between the parties arising under this DPA is subject to the limitations and
          exclusions in the ReviewMaster <Link href="/terms">Terms of Service</Link>,{' '}
          <strong>
            except to the extent Applicable Data Protection Law, the SCCs, UK Addendum or another
            mandatory transfer instrument prohibits such limitation
          </strong>
          .
        </p>

        <H>25. Priority</H>
        <p>If there is a conflict:</p>
        <ol className="list-decimal pl-6">
          <li>mandatory Applicable Data Protection Law applies;</li>
          <li>applicable SCCs, UK Addendum or other mandatory transfer instrument applies;</li>
          <li>this DPA applies;</li>
          <li>the Terms of Service apply.</li>
        </ol>

        <H>26. Term and Termination</H>
        <p>
          This DPA begins when ReviewMaster first Processes Customer Personal Data on behalf of
          the Merchant.
        </p>
        <p>
          It continues until ReviewMaster no longer Processes Customer Personal Data on the
          Merchant&rsquo;s behalf, except provisions that must survive to protect retained
          Personal Data.
        </p>

        <H>ANNEX 1 — DETAILS OF PROCESSING</H>

        <H3>A. Parties</H3>
        <p>
          <strong>Data exporter</strong>
          <br />
          The Shopify Merchant using ReviewMaster.
          <br />
          <strong>Role:</strong> Controller or party acting on behalf of the applicable
          Controller.
          <br />
          <strong>Contact:</strong> Merchant contact details held in Shopify/ReviewMaster account
          records.
        </p>
        <p>
          <strong>Data importer</strong>
          <br />
          <strong>Marka Modern Retail Private Limited</strong>
          <br />
          Operator of ReviewMaster
          <br />
          1st Floor, Plot 558 P, Sector 27, Gurugram (Gurgaon), Haryana 122009, India
          <br />
          Email: {CONTACT_EMAIL}
          <br />
          <strong>Role:</strong> Processor.
        </p>

        <H3>B. Categories of Data Subjects</H3>
        <ul className="list-disc pl-6">
          <li>Merchant customers;</li>
          <li>purchasers;</li>
          <li>reviewers;</li>
          <li>product-question submitters;</li>
          <li>storefront visitors interacting with review functionality;</li>
          <li>persons appearing in user-generated content.</li>
        </ul>

        <H3>C. Categories of Personal Data</H3>
        <ul className="list-disc pl-6">
          <li>name;</li>
          <li>email address;</li>
          <li>order identifier;</li>
          <li>order number;</li>
          <li>purchased-product information;</li>
          <li>review content;</li>
          <li>rating;</li>
          <li>review title;</li>
          <li>review date;</li>
          <li>verification status;</li>
          <li>incentive status;</li>
          <li>optional reviewer location;</li>
          <li>questions and answers;</li>
          <li>review photos/videos;</li>
          <li>review media URLs;</li>
          <li>limited technical/security identifiers;</li>
          <li>related operational metadata.</li>
        </ul>

        <H3>D. Sensitive Data</H3>
        <p>
          Sensitive or special-category data is <strong>not intentionally requested</strong>.
        </p>
        <p>
          Because review content and media are user-generated, a Data Subject may voluntarily
          submit sensitive information.
        </p>
        <p>The Merchant must avoid intentionally soliciting unnecessary sensitive information.</p>

        <H3>E. Frequency</H3>
        <p>
          Processing occurs on a continuous or event-driven basis while ReviewMaster is installed
          and enabled.
        </p>

        <H3>F. Nature of Processing</H3>
        <ul className="list-disc pl-6">
          <li>collection;</li>
          <li>receipt;</li>
          <li>organization;</li>
          <li>structuring;</li>
          <li>storage;</li>
          <li>retrieval;</li>
          <li>consultation;</li>
          <li>display;</li>
          <li>transmission;</li>
          <li>publishing;</li>
          <li>syndication;</li>
          <li>restriction;</li>
          <li>anonymization;</li>
          <li>deletion.</li>
        </ul>

        <H3>G. Purposes</H3>
        <p>Providing the ReviewMaster services configured by the Merchant.</p>

        <H3>H. Retention</H3>
        <p>As stated in Section 11 and the ReviewMaster <Link href="/privacy">Privacy Policy</Link>.</p>
        <p>
          Residual backup copies are deleted or overwritten within no more than{' '}
          <strong>28 days</strong> after applicable production deletion, unless legally required
          otherwise.
        </p>

        <H3>I. Subprocessors</H3>
        <p>Current Subprocessors and processing locations are maintained at:</p>
        <p>
          <strong>
            <Link href="/subprocessors">
              https://reviewmaster-app.azurewebsites.net/subprocessors
            </Link>
          </strong>
        </p>

        <H>ANNEX 2 — TECHNICAL AND ORGANIZATIONAL SECURITY MEASURES</H>
        <p>
          ReviewMaster maintains security measures appropriate to the nature, scope and risk of
          the Processing.
        </p>
        <p>These may include:</p>

        <H3>1. Transport Security</H3>
        <ul className="list-disc pl-6">
          <li>HTTPS for external web traffic;</li>
          <li>TLS-protected database and service connections where supported.</li>
        </ul>

        <H3>2. Credential Protection</H3>
        <ul className="list-disc pl-6">
          <li>Shopify access credentials are not intentionally exposed to storefront visitors;</li>
          <li>sensitive credentials are encrypted or otherwise protected at rest;</li>
          <li>secrets are maintained outside publicly accessible application code.</li>
        </ul>

        <H3>3. Logical Tenant Separation</H3>
        <ul className="list-disc pl-6">
          <li>Merchant records are associated with an individual store;</li>
          <li>application authorization checks restrict Merchant access;</li>
          <li>queries and service operations are scoped to the applicable Merchant.</li>
        </ul>

        <H3>4. Access Control</H3>
        <ul className="list-disc pl-6">
          <li>production access limited to authorized personnel;</li>
          <li>access based on job function and operational need;</li>
          <li>confidentiality obligations for authorized personnel.</li>
        </ul>

        <H3>5. Data Minimization</H3>
        <p>
          ReviewMaster seeks to request and retain only Shopify information reasonably necessary
          for ReviewMaster functionality.
        </p>

        <H3>6. Media Controls</H3>
        <p>Where review media is uploaded to Shopify Files:</p>
        <ul className="list-disc pl-6">
          <li>file types may be validated;</li>
          <li>potentially unsafe file formats may be restricted;</li>
          <li>file size and type controls may be applied.</li>
        </ul>

        <H3>7. Abuse Prevention</H3>
        <p>Controls may include:</p>
        <ul className="list-disc pl-6">
          <li>rate limiting;</li>
          <li>duplicate prevention;</li>
          <li>validation;</li>
          <li>security logging;</li>
          <li>IP-based or cryptographic abuse controls;</li>
          <li>input validation.</li>
        </ul>

        <H3>8. Backup Security</H3>
        <p>Backups are protected from ordinary public access.</p>
        <p>
          Following production deletion, residual encrypted backups containing affected Customer
          Personal Data are automatically deleted or overwritten within no more than{' '}
          <strong>28 days</strong>, unless Applicable Law requires otherwise.
        </p>

        <H3>9. Incident Response</H3>
        <p>ReviewMaster maintains procedures to:</p>
        <ul className="list-disc pl-6">
          <li>identify;</li>
          <li>investigate;</li>
          <li>contain;</li>
          <li>remediate;</li>
          <li>document;</li>
        </ul>
        <p>security incidents and Personal Data Breaches.</p>

        <H3>10. Software and Infrastructure Maintenance</H3>
        <p>
          ReviewMaster uses reasonable processes appropriate to the size and risk of the service
          for:
        </p>
        <ul className="list-disc pl-6">
          <li>updates;</li>
          <li>dependency maintenance;</li>
          <li>vulnerability remediation;</li>
          <li>environment configuration;</li>
          <li>operational monitoring.</li>
        </ul>
      </div>
    </main>
  );
}
