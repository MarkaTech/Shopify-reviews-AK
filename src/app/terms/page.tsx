import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service — ReviewMaster',
  description: 'The merchant agreement governing use of the ReviewMaster Shopify application.',
};

const LAST_UPDATED = '20 August 2026';

/*
 * This page is the binding version of the Terms. It was finalised from the 20 August 2026
 * draft: registered address and arbitration seat filled in, and the draft's editorial
 * verification notes resolved and removed. Substantive edits belong here first — the PDF
 * copies are exports of this page, not the other way round.
 */

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-10 text-xl font-semibold">{children}</h2>;
}

export default function Terms() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-slate-800 dark:text-slate-200">
      <Link href="/" className="text-sm text-emerald-700 hover:underline dark:text-emerald-400">
        &larr; Back to ReviewMaster
      </Link>

      <h1 className="mt-6 text-3xl font-bold tracking-tight">ReviewMaster Terms of Service</h1>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Last updated: {LAST_UPDATED}</p>

      <div className="prose prose-slate dark:prose-invert mt-8 max-w-none space-y-4 text-[15px] leading-relaxed">
        <p>
          These Terms of Service constitute a legally binding merchant agreement between{' '}
          <strong>Marka Modern Retail Private Limited</strong>, a company incorporated under the
          laws of India and operator of ReviewMaster (&ldquo;<strong>ReviewMaster</strong>&rdquo;,
          &ldquo;<strong>Marka</strong>&rdquo;, &ldquo;<strong>we</strong>&rdquo;, &ldquo;<strong>us</strong>&rdquo;,
          or &ldquo;<strong>our</strong>&rdquo;), and the person or entity that installs, accesses,
          subscribes to, or uses the ReviewMaster application (&ldquo;<strong>Merchant</strong>&rdquo;,
          &ldquo;<strong>you</strong>&rdquo;, or &ldquo;<strong>your</strong>&rdquo;).
        </p>
        <p>
          <strong>Registered office:</strong> 1st Floor, Plot 558 P, Sector 27, Gurugram (Gurgaon),
          Haryana 122009, India
          <br />
          <strong>Legal/Support contact:</strong> tech@houseofmarka.com
        </p>
        <p>
          By installing or using ReviewMaster, you confirm that you have read, understood, and
          agreed to these Terms, our <Link href="/privacy">Privacy Policy</Link>, and our{' '}
          <Link href="/dpa">Data Processing Agreement</Link> (&ldquo;DPA&rdquo;), each as amended
          from time to time.
        </p>
        <p>
          If you are installing or using ReviewMaster on behalf of a company or other entity, you
          represent that you have authority to bind that entity.
        </p>
        <p>If you do not agree to these Terms, do not install or use ReviewMaster.</p>

        <H>1. Definitions</H>
        <p>For these Terms:</p>
        <ul>
          <li>
            <strong>App</strong> or <strong>ReviewMaster</strong> means the ReviewMaster Shopify
            application and related services, APIs, dashboards, widgets, integrations,
            documentation and features made available by Marka.
          </li>
          <li>
            <strong>Merchant Content</strong> means reviews, questions and answers, product
            information, media, replies, imported content, configuration data and other materials
            submitted, uploaded, imported, transmitted or made available by or on behalf of a
            Merchant through the App.
          </li>
          <li>
            <strong>Customer</strong> means a customer, purchaser, reviewer, storefront visitor or
            other individual whose information is processed through the App in connection with a
            Merchant.
          </li>
          <li>
            <strong>Shopify</strong> means Shopify Inc. and its applicable affiliates.
          </li>
          <li>
            <strong>Third-Party Service</strong> means Shopify or any other third-party platform,
            network, service, API, hosting provider, email provider, review destination, search
            engine, marketplace or integration used in connection with the App.
          </li>
          <li>
            <strong>Applicable Law</strong> means any law, regulation, binding governmental
            requirement or court order applicable to a party, its processing activities or use of
            the App.
          </li>
        </ul>

        <H>2. The ReviewMaster Service</H>
        <p>ReviewMaster provides tools that may allow Merchants to:</p>
        <ul>
          <li>collect customer product reviews;</li>
          <li>request reviews from eligible customers;</li>
          <li>display reviews on a Shopify storefront;</li>
          <li>identify reviews associated with eligible Shopify orders;</li>
          <li>collect product questions and answers;</li>
          <li>accept customer-uploaded review photos or videos;</li>
          <li>moderate and respond to reviews;</li>
          <li>import reviews through supported and authorized import mechanisms;</li>
          <li>provide review-related analytics;</li>
          <li>create or facilitate eligible review incentives;</li>
          <li>syndicate or transmit reviews to supported third-party destinations;</li>
          <li>create review-related product data, metadata, feeds or structured data;</li>
          <li>use other functionality made available in the App from time to time.</li>
        </ul>
        <p>
          Features available to a Merchant depend on the Merchant&rsquo;s current plan, Shopify
          configuration, geographic availability, technical compatibility, third-party eligibility
          and other conditions.
        </p>
        <p>
          We may add, modify, replace, limit or discontinue features where reasonably necessary
          for security, legal compliance, platform compliance, technical development or operation
          of the App.
        </p>

        <H>3. Relationship with Shopify</H>
        <p>
          ReviewMaster is developed, operated and supported by{' '}
          <strong>Marka Modern Retail Private Limited</strong>, independently from Shopify.
        </p>
        <p>
          Marka, and not Shopify, is responsible for ReviewMaster, including its development,
          operation, maintenance, support, marketing and our handling of Merchant Data through the
          App.
        </p>
        <p>To the maximum extent permitted by Applicable Law:</p>
        <ul>
          <li>Shopify is not responsible for any fault, error, interruption or defect in ReviewMaster;</li>
          <li>Shopify is not responsible for harm arising from the installation or use of ReviewMaster;</li>
          <li>
            except where Shopify expressly states otherwise, Shopify does not provide support for
            ReviewMaster;
          </li>
          <li>disputes concerning ReviewMaster are between the Merchant and Marka;</li>
          <li>
            Marka is responsible for liabilities arising from its development, operation and
            provision of ReviewMaster and its access to or storage of Merchant Data, subject to
            these Terms and Applicable Law.
          </li>
        </ul>
        <p>
          Shopify may modify, suspend or discontinue APIs, permissions, programs, services or
          features on which ReviewMaster depends. Such changes may affect the functionality or
          availability of the App.
        </p>
        <p>
          Nothing in these Terms imposes an obligation on Shopify to continue providing any API,
          feature, integration or service.
        </p>

        <H>4. Merchant Account and Authority</H>
        <p>Access to ReviewMaster is associated with your Shopify store.</p>
        <p>You are responsible for:</p>
        <ul>
          <li>ensuring that persons using your Shopify account are authorized;</li>
          <li>maintaining the security of your Shopify credentials and administrative access;</li>
          <li>activities carried out through authorized access to your store;</li>
          <li>maintaining accurate merchant and contact information;</li>
          <li>ensuring your use of the App complies with Applicable Law.</li>
        </ul>
        <p>
          You must promptly notify us if you reasonably believe that unauthorized access to
          ReviewMaster has occurred.
        </p>

        <H>5. Plans, Charges and Billing</H>
        <p>
          Current subscription plans, included features, usage allowances, prices, trials and
          other commercial terms are displayed in the App, Shopify App Store listing, Shopify
          subscription approval interface or other applicable checkout interface at the time you
          subscribe.
        </p>
        <p>Those current commercial terms form part of your subscription.</p>
        <p>Unless expressly stated otherwise:</p>
        <ul>
          <li>prices are stated exclusive of applicable taxes;</li>
          <li>paid subscriptions are billed using Shopify&rsquo;s authorized billing mechanisms;</li>
          <li>we do not receive or store your payment-card details;</li>
          <li>usage or feature limits may be technically enforced;</li>
          <li>usage allowances may reset according to the period stated in the App;</li>
          <li>unused allowances do not carry forward unless expressly stated.</li>
        </ul>
        <p>
          You authorize Shopify to collect approved subscription and usage charges on our behalf
          in accordance with Shopify&rsquo;s applicable billing terms.
        </p>
        <p>
          You may upgrade, downgrade or cancel through the mechanisms made available by Shopify or
          ReviewMaster.
        </p>
        <h3 className="mt-6 text-lg font-semibold">5.1 Trials</h3>
        <p>If a trial is offered, its duration and conditions will be displayed before activation.</p>
        <p>
          Unless otherwise stated, a paid subscription may begin automatically after an applicable
          trial expires if you have approved the corresponding Shopify subscription and have not
          cancelled it beforehand.
        </p>
        <h3 className="mt-6 text-lg font-semibold">5.2 Refunds</h3>
        <p>Fees are non-refundable except:</p>
        <ul>
          <li>where required by Applicable Law;</li>
          <li>where required under applicable Shopify billing rules; or</li>
          <li>where Marka expressly agrees otherwise.</li>
        </ul>
        <p>
          Any approved adjustment, credit or refund will be processed through mechanisms available
          through Shopify where applicable.
        </p>

        <H>6. Customer Review Requests</H>
        <p>ReviewMaster may enable a Merchant to configure review invitations and follow-up reminders.</p>
        <p>
          By activating such functionality, the Merchant specifically instructs and authorizes
          ReviewMaster to communicate with eligible Customers{' '}
          <strong>
            on the Merchant&rsquo;s behalf and for the configured review-request purposes
          </strong>
          .
        </p>
        <p>The Merchant represents and warrants that:</p>
        <ul>
          <li>it has the right and lawful basis to provide the relevant Customer information to ReviewMaster;</li>
          <li>any consent or other permission legally required to send the communication has been obtained;</li>
          <li>its privacy notice adequately discloses relevant processing;</li>
          <li>
            its use of invitations, reminders, incentives and promotional content complies with
            applicable electronic-marketing, anti-spam, consumer-protection and privacy laws.
          </li>
        </ul>
        <p>
          The legal classification of review invitations, reminders and incentive-related
          communications varies by jurisdiction and may depend on the content of the message.
          ReviewMaster does not represent that any particular communication is universally
          &ldquo;transactional,&rdquo; &ldquo;service&rdquo; or exempt from marketing laws.
        </p>
        <p>
          We may suppress, delay, refuse or discontinue communications where reasonably necessary
          to address:
        </p>
        <ul>
          <li>unsubscribe requests;</li>
          <li>spam complaints;</li>
          <li>permanent bounces;</li>
          <li>deliverability risk;</li>
          <li>legal or regulatory requirements;</li>
          <li>security or abuse;</li>
          <li>third-party platform requirements.</li>
        </ul>

        <H>7. Review Integrity and Authenticity Rules</H>
        <p>
          The Merchant must use ReviewMaster in a manner that accurately represents genuine
          customer opinion and reviewer experience.
        </p>
        <p>You must not:</p>
        <ol>
          <li>create, submit, purchase, commission or procure fake reviews;</li>
          <li>knowingly publish reviews attributed to persons who did not provide them;</li>
          <li>
            condition compensation, discounts or other benefits on a review being positive,
            negative or meeting a minimum rating;
          </li>
          <li>represent an unverified review as a verified purchase;</li>
          <li>alter a review in a way that materially changes the reviewer&rsquo;s meaning;</li>
          <li>
            selectively suppress legitimate reviews for the purpose of materially misrepresenting
            customer sentiment;
          </li>
          <li>import content that you do not have a lawful right to reproduce;</li>
          <li>
            import or republish reviews in a manner that misleadingly implies that a review
            relates to your store, seller identity or product where that is not true;
          </li>
          <li>
            conceal a material incentive or relationship where disclosure is legally or
            contractually required;
          </li>
          <li>
            manipulate aggregate ratings, helpful-vote counts, reviewer identities, dates or
            review provenance;
          </li>
          <li>
            use employees, owners, agents, relatives or other persons with material relationships
            to create misleadingly independent reviews;
          </li>
          <li>use AI, automation or other means to fabricate customer experiences or identities;</li>
          <li>
            use ReviewMaster to engage in review gating or other deceptive review-selection
            practices prohibited by Applicable Law or relevant platform rules.
          </li>
        </ol>
        <p>
          ReviewMaster may establish additional review-integrity procedures, technical controls,
          disclosure requirements or moderation requirements where reasonably necessary to comply
          with law or third-party platform policies.
        </p>

        <H>8. Verified Purchase Status</H>
        <p>
          A &ldquo;Verified Purchase&rdquo; designation may be shown only where ReviewMaster&rsquo;s
          records support an association between the review and an eligible Shopify order or other
          verification method expressly supported by ReviewMaster.
        </p>
        <p>
          Imported, manually entered or storefront-submitted reviews must not be represented as
          verified merely because an import file or Merchant says they are verified.
        </p>
        <p>
          We may remove, modify or refuse a verification designation if we reasonably believe the
          underlying verification is incomplete, inaccurate, manipulated or no longer reliable.
        </p>
        <p>
          The Merchant must not attempt to bypass or falsify ReviewMaster&rsquo;s verification
          controls.
        </p>

        <H>9. Review Incentives</H>
        <p>Where ReviewMaster permits incentives, the following rules apply:</p>
        <ul>
          <li>
            an incentive must not depend, expressly or implicitly, on a positive or negative
            sentiment, a minimum rating or any particular opinion;
          </li>
          <li>where required, the existence of an incentive must be clearly and conspicuously disclosed;</li>
          <li>
            the Merchant remains responsible for determining whether an incentive is lawful in
            every jurisdiction and permitted on every destination platform where the resulting
            review will appear;
          </li>
          <li>
            ReviewMaster may mark incentivized content and may prevent the Merchant from removing
            a required disclosure;
          </li>
          <li>
            ReviewMaster may exclude incentivized reviews from platforms or syndication
            destinations whose policies prohibit or restrict them.
          </li>
        </ul>
        <p>
          If a Merchant offers different incentives based on the <strong>format</strong> of
          user-generated content, including an eligible photo or video submission, the Merchant is
          solely responsible for confirming that such configuration complies with Applicable Law
          and third-party platform policies.
        </p>
        <p>
          ReviewMaster may restrict or disable any incentive configuration that we reasonably
          believe creates legal, regulatory, platform-policy, fraud or consumer-protection risk.
        </p>

        <H>10. Moderation</H>
        <p>
          Unless functionality expressly provides otherwise, the Merchant controls whether
          Merchant Content is published on its storefront.
        </p>
        <p>The Merchant is responsible for the Merchant&rsquo;s moderation decisions.</p>
        <p>
          However, ReviewMaster may, but is not obligated to, restrict, label, refuse, suspend,
          unpublish, quarantine or remove content where we reasonably believe that it:
        </p>
        <ul>
          <li>is fraudulent or manipulated;</li>
          <li>violates these Terms;</li>
          <li>infringes intellectual-property or privacy rights;</li>
          <li>is unlawful;</li>
          <li>creates security or technical risk;</li>
          <li>violates applicable third-party platform requirements;</li>
          <li>exposes ReviewMaster, Shopify or another person to material legal or reputational risk.</li>
        </ul>
        <p>
          Our exercise of these rights does not make us responsible for reviewing or pre-approving
          all Merchant Content.
        </p>

        <H>11. Merchant Representations and Warranties</H>
        <p>The Merchant represents and warrants that:</p>
        <ol>
          <li>it has authority to enter into these Terms;</li>
          <li>its use of ReviewMaster will comply with Applicable Law;</li>
          <li>
            it owns, controls or has obtained all rights, licences, permissions, consents and
            lawful bases necessary for Merchant Content and Customer information supplied to
            ReviewMaster;
          </li>
          <li>
            ReviewMaster&rsquo;s processing of Merchant Content according to the Merchant&rsquo;s
            instructions will not knowingly infringe third-party rights;
          </li>
          <li>
            Customer contact information supplied through Shopify or otherwise may lawfully be
            processed for the functions enabled by the Merchant;
          </li>
          <li>
            it will not use ReviewMaster to mislead Customers about the authenticity, source,
            verification, independence or sentiment of reviews;
          </li>
          <li>
            it will comply with applicable platform rules for Google, Shopify, Shop and other
            enabled destinations;
          </li>
          <li>it will not use ReviewMaster for unlawful discrimination, harassment, fraud or deception.</li>
        </ol>

        <H>12. Merchant Content</H>
        <p>
          As between the Merchant and Marka, the Merchant retains whatever rights the Merchant
          lawfully holds in Merchant Content.
        </p>
        <p>
          We do <strong>not</strong> represent that a Merchant automatically owns copyright or
          other rights in reviews, images, videos or materials created by Customers or third
          parties.
        </p>
        <p>
          The Merchant grants Marka a worldwide, non-exclusive, royalty-free licence, for the
          duration reasonably required to provide the App, to: host; store; reproduce; format;
          process; cache; transmit; display; publish; syndicate; and back up Merchant Content
          solely as reasonably necessary to operate, secure, support and provide ReviewMaster and
          enabled integrations.
        </p>
        <p>
          This licence includes the right to engage authorized subprocessors and enabled
          third-party destinations for those purposes.
        </p>

        <H>13. Review Media</H>
        <p>
          Where ReviewMaster uploads review photos or videos to the Merchant&rsquo;s own Shopify
          Files account, such media may continue to exist in the Merchant&rsquo;s Shopify
          environment after ReviewMaster is uninstalled.
        </p>
        <p>
          The Merchant is responsible for deleting those files from Shopify where desired or
          legally required.
        </p>
        <p>
          ReviewMaster may retain identifiers, URLs or metadata relating to such files only for as
          long as reasonably necessary to provide the App and in accordance with our Privacy
          Policy and DPA.
        </p>

        <H>14. ReviewMaster Intellectual Property</H>
        <p>
          Marka and its licensors own all rights, title and interest in and to ReviewMaster,
          including: software; source code and object code; databases and schemas; algorithms;
          APIs; interfaces; widgets; layouts; trademarks; branding; documentation; designs;
          systems; analytics methods; improvements; updates; and derivative works.
        </p>
        <p>
          Except for the limited right to use the App during your subscription, no
          intellectual-property right is transferred to you.
        </p>
        <p>You must not, except where Applicable Law expressly prevents restriction:</p>
        <ul>
          <li>reverse engineer or attempt to derive source code;</li>
          <li>copy substantial elements of the App;</li>
          <li>bypass access, security, billing or usage controls;</li>
          <li>scrape or systematically extract ReviewMaster proprietary data;</li>
          <li>sublicense, resell or redistribute the App;</li>
          <li>use ReviewMaster confidential information to create a competing copy;</li>
          <li>remove Marka proprietary notices.</li>
        </ul>
        <p>
          Nothing in this section prevents a Merchant from independently developing or using
          competing products without unauthorized use of Marka&rsquo;s confidential information or
          intellectual property.
        </p>

        <H>15. Feedback</H>
        <p>
          If you voluntarily provide suggestions, ideas or feedback concerning ReviewMaster, you
          grant Marka a perpetual, worldwide, irrevocable, transferable, sublicensable and
          royalty-free right to use that feedback without restriction or compensation, provided
          that we do not publicly identify you as its source without permission.
        </p>

        <H>16. Privacy and Data Protection</H>
        <p>
          Our handling of personal information is described in our{' '}
          <Link href="/privacy">
            <strong>Privacy Policy</strong>
          </Link>
          .
        </p>
        <p>
          Where ReviewMaster processes Customer personal data on the Merchant&rsquo;s behalf, the{' '}
          <Link href="/dpa">
            <strong>ReviewMaster Data Processing Agreement</strong>
          </Link>{' '}
          applies and forms part of these Terms.
        </p>
        <p>If there is a conflict concerning processing of Customer personal data:</p>
        <ol>
          <li>applicable mandatory data-protection law prevails;</li>
          <li>applicable Standard Contractual Clauses or mandatory transfer mechanism prevails;</li>
          <li>the DPA prevails;</li>
          <li>these Terms apply thereafter.</li>
        </ol>

        <H>17. Security</H>
        <p>
          We use commercially reasonable technical and organizational measures designed to protect
          the App and data processed through it.
        </p>
        <p>
          However, no online service, network, transmission or storage system can be guaranteed to
          be completely secure.
        </p>
        <p>
          You are responsible for security within your own Shopify environment, devices, accounts,
          staff access and connected systems.
        </p>
        <p>
          You must not perform penetration testing, vulnerability scanning or similar security
          testing against ReviewMaster without prior written authorization, except where a
          non-waivable law expressly permits it.
        </p>
        <p>
          If you discover a potential vulnerability, contact us privately at tech@houseofmarka.com.
        </p>

        <H>18. Acceptable Use</H>
        <p>You must not:</p>
        <ul>
          <li>access another Merchant&rsquo;s data without authorization;</li>
          <li>interfere with or overload ReviewMaster infrastructure;</li>
          <li>distribute malware or harmful code;</li>
          <li>bypass technical limitations;</li>
          <li>use automated methods that materially degrade the service;</li>
          <li>use ReviewMaster for fraud or unlawful activity;</li>
          <li>impersonate another person;</li>
          <li>use Merchant or Customer data obtained through ReviewMaster for an unauthorized purpose;</li>
          <li>violate third-party intellectual-property, privacy or publicity rights;</li>
          <li>attempt unauthorized access to systems or accounts.</li>
        </ul>

        <H>19. Third-Party Services and Integrations</H>
        <p>ReviewMaster depends on Third-Party Services that are outside Marka&rsquo;s control.</p>
        <p>We do not guarantee that:</p>
        <ul>
          <li>a third-party API will remain available;</li>
          <li>Google or another search engine will index or display review information;</li>
          <li>Google Merchant Center will accept a feed;</li>
          <li>Shopify or Shop will accept, display or syndicate any review;</li>
          <li>a particular review will improve search ranking;</li>
          <li>email will reach a Customer&rsquo;s inbox;</li>
          <li>a third-party platform will continue operating a particular program;</li>
          <li>a Shopify theme or third-party theme will remain compatible after it changes.</li>
        </ul>
        <p>Third parties may alter their APIs, policies, eligibility rules and features at any time.</p>
        <p>ReviewMaster may modify or discontinue affected functionality in response.</p>

        <H>20. Service Availability and Changes</H>
        <p>The App is provided on an &ldquo;<strong>as available</strong>&rdquo; basis.</p>
        <p>
          We may conduct maintenance and may temporarily limit service for security, maintenance,
          capacity, legal or technical reasons.
        </p>
        <p>We may change features where reasonably required to:</p>
        <ul>
          <li>comply with law;</li>
          <li>comply with Shopify or third-party requirements;</li>
          <li>respond to security risks;</li>
          <li>improve performance;</li>
          <li>discontinue obsolete technology.</li>
        </ul>
        <p>
          Where a material change significantly reduces the core functionality of a paid plan, we
          will use commercially reasonable efforts to provide notice where practical.
        </p>

        <H>21. Suspension and Termination</H>
        <p>
          You may terminate use of ReviewMaster by uninstalling the App and cancelling applicable
          subscriptions.
        </p>
        <p>We may suspend, limit or terminate access immediately where we reasonably believe that:</p>
        <ul>
          <li>you materially breached these Terms;</li>
          <li>your use violates law;</li>
          <li>your use violates Shopify or third-party platform requirements;</li>
          <li>your use involves fake or manipulated reviews;</li>
          <li>your account creates a material fraud or security risk;</li>
          <li>your use threatens service stability or deliverability;</li>
          <li>payment required for the service is overdue or authorization has ended;</li>
          <li>we are required to do so by a governmental authority or third-party platform;</li>
          <li>
            continuing service would expose Marka, Shopify, Customers or third parties to material
            legal risk.
          </li>
        </ul>
        <p>
          Where reasonable, we may provide notice and an opportunity to cure before termination,
          but we are not required to do so where immediate action is reasonably necessary.
        </p>
        <p>
          Upon termination, data will be handled in accordance with the Privacy Policy, DPA,
          Shopify requirements and Applicable Law.
        </p>

        <H>22. Export and Deletion</H>
        <p>
          Where export functionality is available, the Merchant should export required data{' '}
          <strong>before uninstalling</strong> ReviewMaster.
        </p>
        <p>Following uninstall:</p>
        <ul>
          <li>ReviewMaster&rsquo;s authorization to access the store is revoked or disabled;</li>
          <li>applicable tokens and credentials will be deleted or rendered unusable;</li>
          <li>
            Merchant Data will be deleted in accordance with Shopify requirements, the Privacy
            Policy and DPA;
          </li>
          <li>
            residual encrypted backup copies, where any exist, will be placed beyond active use
            and automatically deleted or overwritten within no more than <strong>28 days</strong>,
            unless Applicable Law requires longer retention.
          </li>
        </ul>
        <p>
          Certain information may be retained where law requires it or where Marka acts as an
          independent controller for a lawful and limited purpose, such as legal records or
          suppression records.
        </p>

        <H>23. Confidentiality</H>
        <p>Each party may receive non-public confidential information belonging to the other.</p>
        <p>Each receiving party will:</p>
        <ul>
          <li>use confidential information only for the contractual relationship;</li>
          <li>protect it using reasonable care;</li>
          <li>
            disclose it only to persons who need it and are subject to appropriate confidentiality
            obligations.
          </li>
        </ul>
        <p>
          Confidential information does not include information that is lawfully public,
          independently developed, already lawfully known, or lawfully received from a third party
          without confidentiality restriction.
        </p>
        <p>
          A party may disclose confidential information where legally required, subject to legally
          permitted notice to the other party.
        </p>

        <H>24. Disclaimer of Warranties</H>
        <p>
          To the maximum extent permitted by Applicable Law, ReviewMaster is provided
          &ldquo;<strong>as is</strong>&rdquo; and &ldquo;<strong>as available.</strong>&rdquo;
        </p>
        <p>
          Marka disclaims all express, implied, statutory and other warranties, including
          warranties of: merchantability; fitness for a particular purpose; non-infringement;
          uninterrupted availability; error-free operation; compatibility; and commercial results.
        </p>
        <p>
          We do not guarantee that ReviewMaster will increase revenue, conversion, search
          visibility, customer trust, rankings or sales.
        </p>
        <p>Nothing in these Terms excludes a warranty or right that cannot legally be excluded.</p>

        <H>25. Limitation of Liability</H>
        <p>
          To the maximum extent permitted by Applicable Law, neither Marka nor its directors,
          officers, employees, affiliates or service providers will be liable for: indirect
          damages; incidental damages; special damages; exemplary or punitive damages;
          consequential damages; loss of profits; loss of revenue; loss of business; loss of
          anticipated savings; loss of goodwill; reputational damage; loss of opportunity;
          business interruption; loss or corruption of data; or cost of substitute services,
          arising from or relating to the App, whether in contract, tort, negligence, statute or
          otherwise, even if advised of the possibility of such loss.
        </p>
        <p>
          Except for liability that cannot lawfully be limited, Marka&rsquo;s aggregate liability
          arising out of or relating to ReviewMaster or these Terms will not exceed the greater
          of:
        </p>
        <ol>
          <li>
            the fees actually paid by the Merchant to Marka for ReviewMaster during the{' '}
            <strong>12 months immediately preceding the event giving rise to the claim</strong>; or
          </li>
          <li>
            <strong>US$100</strong>.
          </li>
        </ol>
        <p>
          This section does not limit rights or liability to the extent a mandatory law or
          applicable Standard Contractual Clause prevents limitation.
        </p>

        <H>26. Merchant Indemnity</H>
        <p>
          To the maximum extent permitted by Applicable Law, the Merchant will defend, indemnify
          and hold harmless Marka, its affiliates, directors, officers, employees, contractors and
          service providers from third-party claims, demands, investigations, regulatory
          proceedings, damages, penalties, settlements, losses and reasonable legal costs arising
          from or relating to:
        </p>
        <ul>
          <li>Merchant Content;</li>
          <li>products or services sold by the Merchant;</li>
          <li>the Merchant&rsquo;s breach of these Terms;</li>
          <li>the Merchant&rsquo;s unlawful instructions;</li>
          <li>
            fake, manipulated, misleading or unlawfully incentivized reviews attributable to
            Merchant conduct;
          </li>
          <li>failure to obtain required rights, licences, consents or permissions;</li>
          <li>unlawful Customer communications configured or instructed by the Merchant;</li>
          <li>
            infringement of third-party intellectual-property, privacy or publicity rights by
            Merchant Content;
          </li>
          <li>the Merchant&rsquo;s violation of Applicable Law or third-party platform policies.</li>
        </ul>
        <p>
          The indemnity does not apply to the extent a claim is finally determined to have been
          directly caused by Marka&rsquo;s material breach of these Terms, gross negligence,
          wilful misconduct or violation of Applicable Law.
        </p>
        <p>
          Marka may control the defence of an indemnified claim with counsel of its choice. The
          Merchant must reasonably cooperate and may not settle a claim in a manner that imposes
          liability, admission or obligation on Marka without Marka&rsquo;s prior written consent.
        </p>

        <H>27. Force Majeure</H>
        <p>
          Neither party is liable for delay or failure caused by circumstances beyond its
          reasonable control, including: internet or telecommunications failures; widespread
          cloud-provider outages; Shopify outages or API disruption; cyberattacks not caused by
          that party&rsquo;s breach; natural disasters; fire; flood; war; terrorism; civil
          disorder; epidemic; governmental action; labour disruption; and interruption of
          utilities.
        </p>
        <p>This section does not excuse payment obligations already accrued.</p>

        <H>28. Governing Law</H>
        <p>
          These Terms and any non-contractual dispute arising from them are governed by the laws
          of <strong>India</strong>, without regard to conflict-of-laws principles.
        </p>
        <p>
          Mandatory rights that Applicable Law does not permit the parties to exclude remain
          unaffected.
        </p>

        <H>29. Dispute Resolution and Arbitration</H>
        <p>
          The parties will first attempt in good faith to resolve a dispute through written
          discussions for at least <strong>30 days</strong> after notice of the dispute.
        </p>
        <p>
          If unresolved, the dispute will be finally resolved by arbitration under the{' '}
          <strong>Arbitration and Conciliation Act, 1996</strong>, as amended.
        </p>
        <p>The arbitration will:</p>
        <ul>
          <li>
            be conducted by one arbitrator mutually appointed by the parties or appointed
            according to Applicable Law if the parties cannot agree;
          </li>
          <li>be conducted in English;</li>
          <li>
            have its seat and legal place at <strong>Gurugram, Haryana, India</strong>;
          </li>
          <li>permit virtual hearings where appropriate.</li>
        </ul>
        <p>The award will be final and binding.</p>
        <p>
          Nothing prevents Marka from seeking urgent interim, injunctive or protective relief from
          a competent court in relation to intellectual property, confidentiality, security,
          misuse of systems or preservation of evidence.
        </p>
        <p>
          Subject to mandatory law, courts having jurisdiction over the agreed arbitral seat will
          have jurisdiction for permitted court proceedings.
        </p>

        <H>30. Changes to these Terms</H>
        <p>We may modify these Terms from time to time.</p>
        <p>
          Where a modification materially affects installed Merchants&rsquo; rights or
          obligations, we will use commercially reasonable means to provide notice before or when
          the change takes effect.
        </p>
        <p>
          Changes required by law, security or platform rules may take effect immediately where
          necessary.
        </p>
        <p>
          Continued use of ReviewMaster after an updated version becomes effective constitutes
          acceptance to the extent permitted by law.
        </p>

        <H>31. Assignment</H>
        <p>You may not assign or transfer these Terms without our prior written consent.</p>
        <p>
          Marka may assign or transfer these Terms, in whole or in part: to an affiliate; in
          connection with a merger, restructuring, acquisition or sale of assets; or to a
          successor to the ReviewMaster business.
        </p>

        <H>32. Entire Agreement and Order of Precedence</H>
        <p>
          These Terms, the Privacy Policy, the DPA and commercial terms approved through Shopify
          constitute the agreement governing ReviewMaster.
        </p>
        <p>If there is a conflict:</p>
        <ul>
          <li>mandatory Applicable Law controls;</li>
          <li>mandatory international-transfer clauses control in relation to covered transfers;</li>
          <li>the DPA controls for processing Customer personal data;</li>
          <li>approved Shopify billing terms control in relation to Shopify billing;</li>
          <li>these Terms otherwise control.</li>
        </ul>

        <H>33. Severability</H>
        <p>
          If a provision is held invalid or unenforceable, it will be enforced to the maximum
          lawful extent and the remaining provisions remain effective.
        </p>

        <H>34. Waiver</H>
        <p>
          Failure to enforce a provision is not a waiver of that provision or any other right.
        </p>

        <H>35. No Partnership</H>
        <p>
          Nothing in these Terms creates a partnership, joint venture, employment, franchise or
          agency relationship between Marka and the Merchant.
        </p>
        <p>
          ReviewMaster acts as a service provider to the Merchant except where expressly stated
          otherwise.
        </p>

        <H>36. Survival</H>
        <p>
          Provisions that by their nature should survive termination will survive, including
          provisions concerning: intellectual property; confidentiality; payment obligations;
          indemnities; limitations of liability; dispute resolution; governing law; and legally
          required data retention.
        </p>

        <H>37. Contact</H>
        <p>Questions regarding these Terms may be sent to:</p>
        <p>
          <strong>Marka Modern Retail Private Limited</strong>
          <br />
          ReviewMaster
          <br />
          1st Floor, Plot 558 P, Sector 27, Gurugram (Gurgaon), Haryana 122009, India
          <br />
          Email: <strong>tech@houseofmarka.com</strong>
        </p>
      </div>
    </main>
  );
}
