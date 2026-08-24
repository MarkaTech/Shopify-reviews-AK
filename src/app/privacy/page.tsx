import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy — ReviewMaster',
  description: 'How ReviewMaster collects, uses, discloses, stores and protects personal information.',
};

const LAST_UPDATED = '20 August 2026';
const CONTACT_EMAIL = 'tech@houseofmarka.com';

/*
 * This page is the binding version of the Privacy Policy. It was finalised from the
 * 20 August 2026 draft: registered address filled in, the production cookie disclosure
 * completed with verified values, the IP-handling statement resolved to the option that
 * matches production (no persisted raw IP), and the draft's editorial verification notes
 * resolved and removed. Substantive edits belong here first — PDF copies are exports of
 * this page, not the other way round.
 */

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-10 text-xl font-semibold">{children}</h2>;
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-6 text-base font-semibold">{children}</h3>;
}

export default function Privacy() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-slate-800 dark:text-slate-200">
      <Link href="/" className="text-sm text-emerald-700 hover:underline dark:text-emerald-400">
        &larr; Back to ReviewMaster
      </Link>

      <h1 className="mt-6 text-3xl font-bold tracking-tight">ReviewMaster Privacy Policy</h1>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Last updated: {LAST_UPDATED}</p>

      <div className="prose prose-slate dark:prose-invert mt-8 max-w-none space-y-4 text-[15px] leading-relaxed">
        <p>
          This Privacy Policy explains how <strong>Marka Modern Retail Private Limited</strong>,
          operator of the ReviewMaster Shopify application (&ldquo;<strong>ReviewMaster</strong>&rdquo;,
          &ldquo;<strong>Marka</strong>&rdquo;, &ldquo;<strong>we</strong>&rdquo;, &ldquo;<strong>us</strong>&rdquo;,
          or &ldquo;<strong>our</strong>&rdquo;), collects, uses, discloses, stores and protects
          personal information.
        </p>
        <p>
          <strong>Registered office:</strong> 1st Floor, Plot 558 P, Sector 27, Gurugram (Gurgaon),
          Haryana 122009, India
          <br />
          <strong>Privacy contact:</strong> {CONTACT_EMAIL}
        </p>
        <p>This Privacy Policy applies to:</p>
        <ol className="list-decimal pl-6">
          <li>Shopify merchants and their personnel who install, configure or interact with ReviewMaster; and</li>
          <li>
            customers, reviewers and storefront visitors whose information ReviewMaster processes
            through a Merchant&rsquo;s use of the App.
          </li>
        </ol>

        <H>1. Our Roles</H>
        <p>ReviewMaster may act in different privacy roles depending on the processing.</p>

        <H3>1.1 Where Marka acts as a processor or service provider</H3>
        <p>
          For personal information belonging to a Merchant&rsquo;s Customers that ReviewMaster
          processes according to the Merchant&rsquo;s instructions, the Merchant generally
          determines the purposes and means of processing and ReviewMaster acts as the
          Merchant&rsquo;s <strong>processor</strong>, <strong>service provider</strong>, or
          equivalent role under Applicable Law.
        </p>
        <p>Examples include:</p>
        <ul className="list-disc pl-6">
          <li>processing order information to send review requests;</li>
          <li>storing Customer reviews;</li>
          <li>associating a review with an order;</li>
          <li>displaying reviews on the Merchant&rsquo;s storefront;</li>
          <li>processing product questions;</li>
          <li>transmitting reviews to integrations enabled by the Merchant.</li>
        </ul>
        <p>
          The ReviewMaster <Link href="/dpa">Data Processing Agreement</Link> governs that
          processing.
        </p>

        <H3>1.2 Where Marka acts as a controller</H3>
        <p>
          Marka may independently determine the purposes and means of processing for limited
          categories of information required to operate our own business, including:
        </p>
        <ul className="list-disc pl-6">
          <li>merchant account and business contact information;</li>
          <li>subscription and administrative records;</li>
          <li>security and fraud-prevention records;</li>
          <li>service-operational logs;</li>
          <li>legal and compliance records;</li>
          <li>support communications;</li>
          <li>
            global email suppression records used to prevent further messages to addresses that
            have unsubscribed, permanently bounced or reported spam.
          </li>
        </ul>
        <p>
          For those activities, Marka acts as a controller or equivalent business role under
          Applicable Law.
        </p>

        <H>2. Information We Receive About Merchants</H>
        <p>
          When a Merchant installs or uses ReviewMaster, Shopify or the Merchant may provide
          information including:
        </p>
        <ul className="list-disc pl-6">
          <li>store name;</li>
          <li>Shopify store domain;</li>
          <li>primary domain;</li>
          <li>Merchant business contact details;</li>
          <li>account or administrative email address;</li>
          <li>installation status;</li>
          <li>Shopify store identifier;</li>
          <li>authentication or authorization credentials made available through Shopify;</li>
          <li>subscription plan;</li>
          <li>installation and uninstall dates;</li>
          <li>App settings;</li>
          <li>widget configuration;</li>
          <li>notification preferences;</li>
          <li>review configuration;</li>
          <li>feature usage and administrative activity;</li>
          <li>communications sent to ReviewMaster support.</li>
        </ul>
        <p>
          Shopify access credentials are used only as necessary to provide the App and are
          protected as described in this Policy and our security measures.
        </p>
        <p>
          We do not obtain Merchant payment-card information through ReviewMaster. Paid App
          billing is processed through Shopify.
        </p>

        <H>3. Shopify Data Access</H>
        <p>ReviewMaster requests only Shopify permissions reasonably necessary for enabled functionality.</p>
        <p>
          Depending on the current version and functionality used, these may include permissions
          relating to:
        </p>
        <ul className="list-disc pl-6">
          <li>products;</li>
          <li>orders;</li>
          <li>eligible Customer details;</li>
          <li>files;</li>
          <li>discount codes;</li>
          <li>subscription or billing status;</li>
          <li>metafields or metaobjects;</li>
          <li>other Shopify resources required for approved ReviewMaster functionality.</li>
        </ul>
        <p>
          ReviewMaster uses Shopify data only for purposes reasonably necessary to provide,
          operate, secure and support the App and as otherwise permitted by Applicable Law and
          Shopify requirements.
        </p>
        <p>We do not use Shopify Merchant Data for unrelated competitive benchmarking.</p>

        <H>4. Customer and Reviewer Information</H>
        <p>
          Depending on the Merchant&rsquo;s configuration and the Customer&rsquo;s interaction
          with ReviewMaster, we may process:
        </p>

        <H3>Identity and contact information</H3>
        <ul className="list-disc pl-6">
          <li>Customer or reviewer name;</li>
          <li>display name;</li>
          <li>email address;</li>
          <li>optional location supplied by the Merchant or Customer.</li>
        </ul>

        <H3>Order and verification information</H3>
        <ul className="list-disc pl-6">
          <li>Shopify order identifier;</li>
          <li>order number;</li>
          <li>order status;</li>
          <li>eligible purchased products;</li>
          <li>fulfillment information;</li>
          <li>
            information necessary to determine whether a review qualifies for a verified-purchase
            designation.
          </li>
        </ul>
        <p>
          We do not intentionally request postal addresses or telephone numbers for ReviewMaster
          review functionality unless a future feature expressly requires and discloses them.
        </p>

        <H3>Review information</H3>
        <ul className="list-disc pl-6">
          <li>rating;</li>
          <li>review title;</li>
          <li>review text;</li>
          <li>review date;</li>
          <li>reviewer display details;</li>
          <li>verification status;</li>
          <li>incentive status;</li>
          <li>Merchant replies;</li>
          <li>source or import status.</li>
        </ul>

        <H3>Questions and answers</H3>
        <p>Where enabled:</p>
        <ul className="list-disc pl-6">
          <li>Customer name;</li>
          <li>question;</li>
          <li>Customer email where provided;</li>
          <li>Merchant response;</li>
          <li>applicable dates and product relationship.</li>
        </ul>

        <H3>Review incentive information</H3>
        <p>Where incentives are enabled:</p>
        <ul className="list-disc pl-6">
          <li>Customer email;</li>
          <li>issuance status;</li>
          <li>related discount-code identifier;</li>
          <li>expiry;</li>
          <li>information necessary to prevent duplicate incentive issuance.</li>
        </ul>

        <H3>Photos and videos</H3>
        <p>A Customer may choose to submit review photographs or videos.</p>
        <p>
          Where the current implementation uploads review media into the Merchant&rsquo;s Shopify
          Files account:
        </p>
        <ul className="list-disc pl-6">
          <li>the media is stored by Shopify on the Merchant&rsquo;s behalf;</li>
          <li>ReviewMaster may temporarily receive or validate the upload;</li>
          <li>ReviewMaster may store the resulting Shopify media URL and related metadata.</li>
        </ul>
        <p>
          The Merchant remains responsible for managing media stored in its Shopify account after
          ReviewMaster is removed.
        </p>

        <H>5. Technical and Security Information</H>
        <p>We may process limited technical information necessary for:</p>
        <ul className="list-disc pl-6">
          <li>request authentication;</li>
          <li>security;</li>
          <li>abuse prevention;</li>
          <li>fraud detection;</li>
          <li>rate limiting;</li>
          <li>reliability;</li>
          <li>troubleshooting;</li>
          <li>storefront analytics.</li>
        </ul>
        <p>This information may include:</p>
        <ul className="list-disc pl-6">
          <li>IP address;</li>
          <li>a truncated or cryptographic representation of an IP address;</li>
          <li>browser user-agent;</li>
          <li>timestamp;</li>
          <li>request information;</li>
          <li>device/browser characteristics;</li>
          <li>event type.</li>
        </ul>
        <p>
          Raw shopper IP addresses are not persistently stored. Where used for abuse prevention,
          an IP address may be transformed into a non-reversible or limited-purpose value and
          retained only for the period necessary to prevent repeated abusive activity.
        </p>

        <H>6. How We Use Personal Information</H>
        <p>We process information where reasonably necessary to:</p>
        <ul className="list-disc pl-6">
          <li>install and authenticate ReviewMaster;</li>
          <li>provide Merchant-requested functionality;</li>
          <li>synchronize eligible Shopify data;</li>
          <li>collect and display reviews;</li>
          <li>send review invitations or reminders on behalf of a Merchant;</li>
          <li>identify eligible verified purchases;</li>
          <li>provide questions and answers;</li>
          <li>issue configured review incentives;</li>
          <li>moderate, publish and syndicate reviews;</li>
          <li>provide analytics;</li>
          <li>administer subscriptions;</li>
          <li>enforce plan limits;</li>
          <li>provide support;</li>
          <li>diagnose and resolve errors;</li>
          <li>maintain service security and reliability;</li>
          <li>prevent fraud, spam and abuse;</li>
          <li>honour unsubscribe and suppression requests;</li>
          <li>comply with law, court orders and regulatory requirements;</li>
          <li>establish, exercise or defend legal claims.</li>
        </ul>

        <H>7. Legal Bases Where Marka Acts as Controller</H>
        <p>
          Where GDPR, UK GDPR or another law requiring a legal basis applies and Marka acts as
          controller, we may rely on:
        </p>

        <H3>Contract</H3>
        <p>Where processing is necessary to:</p>
        <ul className="list-disc pl-6">
          <li>administer a Merchant&rsquo;s account;</li>
          <li>provide contracted services;</li>
          <li>process subscription administration;</li>
          <li>respond to contractual requests.</li>
        </ul>

        <H3>Legitimate interests</H3>
        <p>
          Where necessary for our legitimate interests, balanced against the rights of
          individuals, including:
        </p>
        <ul className="list-disc pl-6">
          <li>securing ReviewMaster;</li>
          <li>preventing fraud and abuse;</li>
          <li>preventing unwanted email after opt-out;</li>
          <li>maintaining deliverability;</li>
          <li>troubleshooting;</li>
          <li>protecting legal rights;</li>
          <li>operating and improving service reliability.</li>
        </ul>

        <H3>Legal obligation</H3>
        <p>Where processing is required for:</p>
        <ul className="list-disc pl-6">
          <li>accounting;</li>
          <li>taxation;</li>
          <li>lawful government requests;</li>
          <li>regulatory compliance;</li>
          <li>legal record keeping.</li>
        </ul>

        <H3>Consent</H3>
        <p>
          Where we specifically request consent for processing and consent is the appropriate
          lawful basis.
        </p>
        <p>Consent may be withdrawn where Applicable Law provides that right.</p>
        <p>
          Where ReviewMaster acts only as a Merchant&rsquo;s processor, the Merchant is
          responsible for identifying the lawful basis for its underlying Customer processing.
        </p>

        <H>8. Customer Communications</H>
        <p>
          ReviewMaster may send review invitations, reminders or related messages to Customers{' '}
          <strong>
            only on behalf of and according to the configuration or instructions of a Merchant
          </strong>
          , subject to our technical, compliance and suppression controls.
        </p>
        <p>
          The Merchant is responsible for ensuring that it has a lawful basis, consent or other
          permission required under Applicable Law.
        </p>
        <p>ReviewMaster may prevent communications to addresses that:</p>
        <ul className="list-disc pl-6">
          <li>unsubscribed;</li>
          <li>permanently bounced;</li>
          <li>reported spam;</li>
          <li>are otherwise suppressed for legal, deliverability or abuse-prevention reasons.</li>
        </ul>

        <H>9. Email Suppression Records</H>
        <p>
          To avoid sending further ReviewMaster-enabled messages to persons who have opted out,
          reported spam or experienced permanent delivery failure, Marka may maintain a limited
          suppression record.
        </p>
        <p>A suppression record may contain:</p>
        <ul className="list-disc pl-6">
          <li>email address or a suitable suppression identifier;</li>
          <li>reason for suppression;</li>
          <li>date or related operational information.</li>
        </ul>
        <p>
          Marka acts as controller for this limited processing where we determine that the record
          must apply across the ReviewMaster platform.
        </p>
        <p>
          We retain suppression information for as long as reasonably necessary to ensure the
          applicable address remains suppressed, subject to Applicable Law.
        </p>
        <p>
          Deleting that record may cause an individual who previously opted out to receive another
          message, so suppression records may outlive other information relating to that Customer.
        </p>

        <H>10. Cookies and Browser Storage</H>
        <p>ReviewMaster may use limited first-party cookies or browser storage necessary to:</p>
        <ul className="list-disc pl-6">
          <li>maintain Merchant sessions;</li>
          <li>prevent session abuse;</li>
          <li>remember non-tracking storefront preferences;</li>
          <li>prevent repeated &ldquo;helpful&rdquo; votes;</li>
          <li>remember that a storefront popup was dismissed during a visit.</li>
        </ul>
        <p>We do not use ReviewMaster cookies for third-party behavioral advertising.</p>
        <p>The Merchant session cookie currently in production is:</p>
        <ul className="list-disc pl-6">
          <li>
            cookie name: <code>reviewmaster_session</code>;
          </li>
          <li>purpose: Merchant session continuity and security;</li>
          <li>maximum duration: 30 days;</li>
          <li>
            the cookie is cryptographically signed to prevent tampering; its contents are not
            encrypted and are limited to session identifiers;
          </li>
          <li>Shopify access tokens are never stored in the cookie.</li>
        </ul>
        <p>Shopify access tokens are not exposed to storefront visitors.</p>

        <H>11. Public Review Information</H>
        <p>
          Where a Merchant publishes a review, some review information is intentionally made
          public.
        </p>
        <p>Depending on the configuration, public information may include:</p>
        <ul className="list-disc pl-6">
          <li>reviewer display name;</li>
          <li>reviewer-supplied location;</li>
          <li>rating;</li>
          <li>title;</li>
          <li>review text;</li>
          <li>review media;</li>
          <li>date;</li>
          <li>verification status;</li>
          <li>incentive disclosure;</li>
          <li>helpful-vote count;</li>
          <li>Merchant reply;</li>
          <li>review source.</li>
        </ul>
        <p>
          We do not intentionally publish reviewer email addresses or Shopify order identifiers
          through the storefront review widget.
        </p>
        <p>
          Customers should not include personal information in review content that they do not
          want displayed publicly.
        </p>

        <H>12. Review Integrations and Syndication</H>
        <p>
          At a Merchant&rsquo;s instruction, ReviewMaster may transmit eligible review information
          to third-party services or platforms, including supported Shopify or Google
          functionality.
        </p>
        <p>Data sent depends on the requirements of the destination and may include:</p>
        <ul className="list-disc pl-6">
          <li>reviewer display name;</li>
          <li>rating;</li>
          <li>title;</li>
          <li>review text;</li>
          <li>review date;</li>
          <li>verification information;</li>
          <li>incentive status;</li>
          <li>product identifiers.</li>
        </ul>
        <p>
          Destination platforms independently determine their own use of data once lawfully
          received.
        </p>
        <p>
          ReviewMaster does not guarantee that a destination will accept, publish, rank, index or
          continue displaying any review.
        </p>

        <H>13. Service Providers and Subprocessors</H>
        <p>We use service providers to operate ReviewMaster.</p>
        <p>
          The authoritative current list of subprocessors that process personal data on our behalf
          is published at:
        </p>
        <p>
          <strong>
            <Link href="/subprocessors">
              https://reviewmaster-app.azurewebsites.net/subprocessors
            </Link>
          </strong>
        </p>
        <p>The list may include providers for:</p>
        <ul className="list-disc pl-6">
          <li>cloud hosting;</li>
          <li>database hosting;</li>
          <li>transactional email;</li>
          <li>Shopify platform services;</li>
          <li>security or operational infrastructure.</li>
        </ul>
        <p>
          Our subprocessors are contractually required to protect personal data in accordance with
          applicable obligations.
        </p>
        <p>We may also disclose information:</p>
        <ul className="list-disc pl-6">
          <li>to professional advisers;</li>
          <li>to auditors;</li>
          <li>to insurers;</li>
          <li>in connection with a corporate transaction;</li>
          <li>where legally required;</li>
          <li>
            to protect Marka, Merchants, Customers, Shopify or other persons from fraud, abuse,
            security threats or unlawful conduct.
          </li>
        </ul>

        <H>14. No Sale or Behavioral Advertising</H>
        <p>ReviewMaster does not sell Customer personal information for money.</p>
        <p>ReviewMaster does not use Customer review data for third-party behavioral advertising.</p>
        <p>
          ReviewMaster does not disclose Merchant or Customer information to advertisers for
          cross-context behavioral advertising.
        </p>
        <p>
          Where a particular privacy law defines &ldquo;sale&rdquo; or &ldquo;sharing&rdquo; more
          broadly, we intend not to engage in activities that constitute sale or sharing for
          cross-context behavioral advertising through ReviewMaster.
        </p>

        <H>15. AI and Automated Content</H>
        <p>
          ReviewMaster does not use Customer review text to train Marka-owned general-purpose
          artificial-intelligence models.
        </p>
        <p>
          Review text is not transmitted to a third-party generative-AI provider for rewriting or
          model training.
        </p>

        <H>16. International Processing and Transfers</H>
        <p>Marka is established in India.</p>
        <p>
          ReviewMaster may process personal information in countries other than the country where
          a Merchant or Customer is located.
        </p>
        <p>
          Current hosting, email and other processing locations are described in our{' '}
          <Link href="/dpa">DPA</Link> and <Link href="/subprocessors">Subprocessor List</Link>.
        </p>
        <p>
          Where personal information protected by EEA, UK, Swiss or other international-transfer
          rules is transferred to a country not recognized as providing adequate protection, we
          use an applicable transfer mechanism where legally required, which may include:
        </p>
        <ul className="list-disc pl-6">
          <li>European Commission Standard Contractual Clauses;</li>
          <li>the UK International Data Transfer Addendum;</li>
          <li>other lawful transfer safeguards.</li>
        </ul>
        <p>
          Additional details are provided in our <Link href="/dpa">DPA</Link>.
        </p>

        <H>17. Data Security</H>
        <p>
          We maintain technical and organizational measures designed to protect personal
          information against unauthorized:
        </p>
        <ul className="list-disc pl-6">
          <li>access;</li>
          <li>disclosure;</li>
          <li>alteration;</li>
          <li>loss;</li>
          <li>destruction.</li>
        </ul>
        <p>Measures may include, as appropriate:</p>
        <ul className="list-disc pl-6">
          <li>HTTPS/TLS encryption in transit;</li>
          <li>encryption of sensitive credentials at rest;</li>
          <li>access controls;</li>
          <li>logical separation of Merchant data;</li>
          <li>secret management;</li>
          <li>least-privilege access;</li>
          <li>logging;</li>
          <li>dependency and system maintenance;</li>
          <li>backups;</li>
          <li>incident-response procedures.</li>
        </ul>
        <p>No online system can guarantee absolute security.</p>

        <H>18. Retention</H>
        <p>
          We retain information only for as long as reasonably necessary for the purposes
          described in this Policy, contractual obligations, platform requirements or Applicable
          Law.
        </p>

        <H3>Merchant data</H3>
        <p>
          While ReviewMaster remains installed, data required to provide the service may be
          retained for the duration of the relationship.
        </p>

        <H3>Review invitations</H3>
        <p>
          Personal information associated with review requests is retained only for the period
          reasonably necessary to send the request, reminders, verify the resulting review,
          prevent duplicate requests and meet legal or operational requirements.
        </p>
        <p>Single-use invitation links should expire within the period stated in the App.</p>

        <H3>Reviews</H3>
        <p>
          Published review information may be retained while ReviewMaster is installed and the
          Merchant requires the review to be provided through the service.
        </p>

        <H3>Operational and analytics information</H3>
        <p>
          Identifiable technical information, if retained, is kept for limited periods appropriate
          to its security, fraud-prevention or operational purpose.
        </p>

        <H3>Backups</H3>
        <p>Residual personal information that remains solely in encrypted backups after deletion is:</p>
        <ul className="list-disc pl-6">
          <li>placed beyond ordinary active use;</li>
          <li>not restored to production except where legitimately necessary for disaster recovery;</li>
          <li>
            automatically deleted or overwritten within no more than <strong>28 days</strong>{' '}
            after the relevant production deletion, unless Applicable Law requires otherwise.
          </li>
        </ul>

        <H3>Legal records</H3>
        <p>Marka may retain records required for:</p>
        <ul className="list-disc pl-6">
          <li>taxation;</li>
          <li>accounting;</li>
          <li>security;</li>
          <li>fraud prevention;</li>
          <li>legal claims;</li>
          <li>regulatory compliance,</li>
        </ul>
        <p>for the period required or permitted by Applicable Law.</p>

        <H>19. Shopify Privacy Webhooks and Deletion</H>
        <p>
          ReviewMaster supports Shopify&rsquo;s applicable mandatory privacy/compliance
          mechanisms.
        </p>

        <H3>Customer data requests</H3>
        <p>
          Where Shopify or a Merchant forwards an eligible Customer data request, ReviewMaster
          will provide information reasonably necessary for the Merchant to respond, subject to
          Applicable Law and the <Link href="/dpa">DPA</Link>.
        </p>

        <H3>Customer redaction</H3>
        <p>
          When ReviewMaster receives an enforceable Customer deletion/redaction instruction, we
          delete or irreversibly anonymize Customer personal data as required.
        </p>
        <p>
          We will{' '}
          <strong>
            not automatically assume that free-text review content is anonymous merely because the
            reviewer&rsquo;s email or display name has been removed
          </strong>
          .
        </p>
        <p>
          Where review text, media or other content itself identifies the individual, it may also
          require deletion or additional anonymization.
        </p>
        <p>
          ReviewMaster may retain only information independently permitted or required to be
          retained, such as an applicable suppression record.
        </p>

        <H3>Shop redaction / uninstall</H3>
        <p>
          Following uninstall, applicable Merchant Data is deleted within Shopify&rsquo;s required
          period and ordinarily substantially sooner through ReviewMaster&rsquo;s uninstall and
          redaction processes.
        </p>
        <p>
          Credentials enabling ReviewMaster to access the Merchant store are deleted, revoked or
          rendered unusable when no longer authorized.
        </p>

        <H>20. Rights of Merchants and Individuals</H>
        <p>Depending on Applicable Law, an individual may have rights including:</p>
        <ul className="list-disc pl-6">
          <li>access;</li>
          <li>correction;</li>
          <li>deletion;</li>
          <li>restriction;</li>
          <li>objection;</li>
          <li>portability;</li>
          <li>withdrawal of consent;</li>
          <li>complaint to a competent supervisory authority.</li>
        </ul>
        <p>These rights are not absolute and may be subject to legal exceptions.</p>

        <H3>Customers of Merchants</H3>
        <p>
          If you are a Customer who submitted information through a Merchant&rsquo;s store, the
          Merchant generally controls that information.
        </p>
        <p>You should normally submit your request to the Merchant first.</p>
        <p>
          ReviewMaster will assist the Merchant according to our <Link href="/dpa">DPA</Link> and
          Applicable Law.
        </p>
        <p>
          Where Marka independently controls a particular record, such as a suppression record or
          Marka&rsquo;s own correspondence with you, you may contact us directly.
        </p>

        <H>21. EEA and UK Individuals</H>
        <p>Where GDPR or UK GDPR applies, individuals may have rights under those laws.</p>
        <p>
          Where Marka acts as a processor, requests should generally be handled through the
          relevant Merchant controller.
        </p>
        <p>Where Marka acts as controller, you may contact:</p>
        <p>
          <strong>{CONTACT_EMAIL}</strong>
        </p>

        <H>22. United States State Privacy Rights</H>
        <p>
          Residents of certain US states may have additional rights under applicable state privacy
          laws.
        </p>
        <p>
          Where such a law applies to Marka&rsquo;s own controller/business processing, we will
          honour legally applicable rights.
        </p>
        <p>
          Where ReviewMaster acts as a processor/service provider for a Merchant, the Merchant is
          responsible for receiving applicable consumer requests and ReviewMaster will assist as
          required by the <Link href="/dpa">DPA</Link>.
        </p>
        <p>
          ReviewMaster does not use Customer personal information for targeted advertising or sell
          Customer personal information through ReviewMaster.
        </p>

        <H>23. India Privacy Requirements</H>
        <p>Marka complies with applicable Indian privacy, data-protection and cybersecurity laws.</p>
        <p>
          This includes compliance with the{' '}
          <strong>
            Digital Personal Data Protection Act, 2023 and applicable rules to the extent their
            respective provisions are in force and applicable to our processing
          </strong>
          , together with other presently applicable Indian legal requirements.
        </p>
        <p>
          As additional provisions become legally effective, Marka will update its processes and
          notices where required.
        </p>

        <H>24. Children&rsquo;s Information</H>
        <p>
          ReviewMaster is intended for use in connection with ordinary ecommerce reviews and is
          not directed to children.
        </p>
        <p>
          We do not knowingly design ReviewMaster to solicit personal information directly from
          children under <strong>16</strong>.
        </p>
        <p>
          Merchants must not knowingly use ReviewMaster to collect children&rsquo;s personal data
          where doing so would violate Applicable Law.
        </p>
        <p>
          If you believe a child has submitted personal information unlawfully through
          ReviewMaster, contact the relevant Merchant or email us at {CONTACT_EMAIL}.
        </p>

        <H>25. Business Transfers</H>
        <p>If Marka or ReviewMaster is involved in a:</p>
        <ul className="list-disc pl-6">
          <li>merger;</li>
          <li>acquisition;</li>
          <li>financing;</li>
          <li>reorganization;</li>
          <li>insolvency;</li>
          <li>sale of assets;</li>
          <li>transfer of business,</li>
        </ul>
        <p>
          information may be disclosed or transferred as part of that transaction, subject to
          appropriate confidentiality and data-protection obligations.
        </p>

        <H>26. Legal Disclosure</H>
        <p>
          We may preserve or disclose information where we reasonably believe doing so is
          necessary to:
        </p>
        <ul className="list-disc pl-6">
          <li>comply with Applicable Law;</li>
          <li>respond to lawful legal process;</li>
          <li>enforce our agreements;</li>
          <li>protect legal rights;</li>
          <li>investigate fraud;</li>
          <li>protect security;</li>
          <li>prevent harm.</li>
        </ul>
        <p>
          Where legally permitted and appropriate, we may notify the affected Merchant before
          disclosure.
        </p>

        <H>27. Changes to this Privacy Policy</H>
        <p>We may update this Policy as ReviewMaster changes.</p>
        <p>
          If a change materially affects how personal information is processed, we will use
          commercially reasonable means to inform affected installed Merchants where required.
        </p>
        <p>The &ldquo;Last updated&rdquo; date identifies the current version.</p>

        <H>28. Contact</H>
        <p>Privacy questions and legally applicable requests may be sent to:</p>
        <p>
          <strong>Marka Modern Retail Private Limited</strong>
          <br />
          ReviewMaster
          <br />
          1st Floor, Plot 558 P, Sector 27, Gurugram (Gurgaon), Haryana 122009, India
          <br />
          Email: <strong>{CONTACT_EMAIL}</strong>
        </p>
      </div>
    </main>
  );
}
