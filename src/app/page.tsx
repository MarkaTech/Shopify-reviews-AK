'use client';

import React, { useState, useEffect, useCallback } from 'react';
import TopNav, { type PageId, type NavigateOptions } from '@/components/app/TopNav';
import { ConfirmProvider } from '@/components/app/confirm';
import dynamic from 'next/dynamic';
import DashboardPage from '@/components/app/DashboardPage';
import WelcomeScreen from '@/components/app/WelcomeScreen';

/**
 * Every screen except the dashboard is loaded on demand.
 *
 * All eight screens used to be static imports, which put ~1.4 MB of decoded JavaScript
 * (~8,000 lines of components) into the initial bundle. Inside Shopify's iframe on a cold
 * cache that meant 20-30 seconds of blank white frame before hydration - measured against
 * a 405 ms TTFB, so the server was never the problem. Only the dashboard, the default
 * screen, earns a place in the first paint; the rest arrive when navigated to, behind a
 * skeleton so the frame is never empty.
 *
 * `ssr: false` because these are client components driven entirely by authenticated
 * fetches - there is nothing useful to render on the server, and skipping it keeps
 * hydration cheap.
 */
function PageSkeleton() {
  return (
    // Static, as the guidelines ask of loading states; the status line says what is happening.
    <div className="space-y-4" role="status" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="surface h-28 rounded-2xl" />
        ))}
      </div>
      <div className="surface h-14 rounded-2xl" />
      <div className="surface h-72 rounded-2xl" />
    </div>
  );
}
const loading = () => <PageSkeleton />;
const ReviewsPage = dynamic(() => import('@/components/app/ReviewsPage'), { ssr: false, loading });
const BulkUploadPage = dynamic(() => import('@/components/app/BulkUploadPage'), { ssr: false, loading });
const WidgetsPage = dynamic(() => import('@/components/app/WidgetsPage'), { ssr: false, loading });
const SettingsPage = dynamic(() => import('@/components/app/SettingsPage'), { ssr: false, loading });
const ProductsPage = dynamic(() => import('@/components/app/ProductsPage'), { ssr: false, loading });
const QuestionsPage = dynamic(() => import('@/components/app/QuestionsPage'), { ssr: false, loading });
const IncentivesPage = dynamic(() => import('@/components/app/IncentivesPage'), { ssr: false, loading });
import { Toaster, toast } from 'sonner';
import { ExternalLink, ChevronRight } from 'lucide-react';
import { APP_NAME, BRAND_ASSETS } from '@/lib/brand';
import { MarkaLockup } from '@/components/app/ui-kit';
import { PENDING_PLAN_KEY } from '@/lib/admin-links';
import { parsePendingPlan, classifyPlanReturn, planArrived, planName, upgradeMayStillLand, type PendingPlanChange } from '@/lib/plan-return';
import { apiFetch, ApiError } from '@/lib/api-client';

const PAGE_TITLES: Record<PageId, { title: string; desc: string; parent?: string }> = {
  dashboard: { title: 'Dashboard', desc: 'How your reviews are performing' },
  reviews: { title: 'All reviews', desc: 'Moderate, reply to and feature customer reviews', parent: 'Reviews' },
  'bulk-upload': { title: 'Import', desc: 'Bring in reviews you own, or collect them from real orders', parent: 'Reviews' },
  questions: { title: 'Questions', desc: 'Answer shopper questions and publish them to product pages', parent: 'Reviews' },
  products: { title: 'Products', desc: 'Products synced from your Shopify catalogue', parent: 'Store' },
  widgets: { title: 'Widgets', desc: 'Design how reviews appear on your storefront', parent: 'Store' },
  incentives: { title: 'Incentives', desc: 'Reward reviewers with a discount — never tied to what they say', parent: 'Store' },
  settings: { title: 'Settings', desc: 'Moderation rules, email timing and integrations', parent: 'Store' },
  plan: { title: 'Plan & billing', desc: 'What you are on, what it includes and what you pay', parent: 'Store' },
};

const PAGE_IDS = Object.keys(PAGE_TITLES) as PageId[];

/**
 * Which screen the URL is asking for.
 *
 * The app had no addressable state at all: `currentPage` was React state and nothing
 * else, so no screen could be linked to, bookmarked, or reached by the back button, and
 * a reload always landed on the dashboard.
 *
 * That became a blocker rather than a nicety with the Shopify navigation menu below.
 * `ui-nav-menu` is rendered by Shopify in the admin chrome, *outside* this iframe, so a
 * click on it cannot be intercepted here — App Bridge navigates the frame to the href.
 * The only way to honour it is for the href to say which screen it wants.
 */
function pageFromUrl(): PageId | null {
  if (typeof window === 'undefined') return null;
  const requested = new URLSearchParams(window.location.search).get('page');
  return requested && (PAGE_IDS as string[]).includes(requested) ? (requested as PageId) : null;
}

interface StoreSummary {
  name: string;
  shopifyDomain?: string;
  domain?: string;
  plan: string;
}

/** The slice of /api/usage the shell reads: the plan chip and the request meter. */
interface UsageSummary {
  plan: string;
  pendingReviews: number;
  requests: { used: number; limit: number | null };
}

/**
 * How long to keep asking after a payment that Shopify has taken but /api/billing/confirm
 * could not yet classify. Five tries, three seconds apart: the webhook or the server's own
 * retry normally lands well inside that, and a merchant who has just paid should see the
 * chip change without being told to reload.
 */
// A minute in all, which is what the toast promises.
const PLAN_POLL_ATTEMPTS = 12;
const PLAN_POLL_INTERVAL_MS = 5000;

/**
 * A server-supplied failure reason, made safe to print under the generic line.
 *
 * Plain text only — anything that looks like markup is dropped rather than rendered —
 * and short, so a stack trace that somehow reached a response body cannot fill the card.
 */
function sanitiseReason(message: string): string {
  const clean = message.replace(/[<>]/g, '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length > 160 ? `${clean.slice(0, 157)}…` : clean;
}

export default function Home() {
  // Initialised from the URL, so a reload, a bookmark or a nav-menu click all land on
  // the screen that was asked for rather than on the dashboard.
  const [currentPage, setCurrentPage] = useState<PageId>(() => pageFromUrl() ?? 'dashboard');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [storeName, setStoreName] = useState('');
  const [storeDomain, setStoreDomain] = useState('');
  const [storePlan, setStorePlan] = useState('free');
  // Usage for the top bar's plan meter. Kept here rather than inside TopNav so a
  // single fetch serves both it and anything else the shell needs.
  // `cap` starts undefined, not null. Null means "no cap - unlimited", which is a plan
  // entitlement; undefined means "not fetched yet". Collapsing the two painted an
  // "Unlimited" badge on the Free plan for the first seconds of every load, which is a
  // pricing claim, not a loading state. TopNav shows a shimmer for undefined.
  const [usage, setUsage] = useState<{ requests: number; cap: number | null | undefined; pending: number }>({
    requests: 0,
    cap: undefined,
    pending: 0,
  });

  // Derive initial error from URL search params (no setState needed)
  const getInitialError = () => {
    if (typeof window === 'undefined') return '';
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    if (error) {
      window.history.replaceState({}, '', window.location.pathname);
      return error || 'Authentication failed';
    }
    return '';
  };
  const [authError, setAuthError] = useState(getInitialError);
  // The server's own reason when the session could not be established, shown under the
  // generic line. The embedded failure card used to say "Your session expired" for every
  // failure, including a managed-install bootstrap the API had rejected with a specific
  // message — so a new merchant was told to reload, which repeated the failure, and
  // support had nothing from the screen to go on.
  const [authDetail, setAuthDetail] = useState('');
  // Set when Shopify has taken the payment but confirm could not yet classify it. Drives
  // the short poll below so the plan chip catches up without a reload. Holds the change
  // the merchant went to Shopify for (empty when none was recorded), so the poll waits
  // for THAT plan; null when nothing is pending.
  const [planPending, setPlanPending] = useState<PendingPlanChange | null>(null);
  // The Plan page calls this before it changes the plan, so a check still running from the
  // last return from Shopify cannot finish afterwards and announce the old answer.
  const stopPlanCheck = useCallback(() => setPlanPending(null), []);
  // A return from Shopify that did not unlock anything — a declined change between paid
  // plans, or an approved move down — said in a toast once the shell is up. Held in state
  // for the same reason as the pending toast: checkSession runs before the Toaster exists.
  const [planNotice, setPlanNotice] = useState<{ text: string; tone: 'neutral' | 'success' } | null>(null);
  // Bumped when the poll sees the paid plan arrive, so the Plan page (which holds its own
  // copy of usage) knows to fetch again.
  const [usageVersion, setUsageVersion] = useState(0);

  // Whether we are inside Shopify's admin iframe. Defaults to true so the server render
  // and the first client paint agree; corrected after mount. Outside the iframe there is
  // no App Bridge and no session token, and `ui-nav-menu` degrades to a row of bare
  // links - that surface is not meant to exist, so we don't render it.
  const [isEmbedded, setIsEmbedded] = useState(true);
  useEffect(() => {
    setIsEmbedded(window.self !== window.top);
  }, []);
  const pageInfo = PAGE_TITLES[currentPage];

  // Check existing session on mount
  const checkSession = useCallback(async () => {
    try {
      // Coming back from Shopify's subscription approval screen.
      //
      // Shopify redirects here with ?billing=success after the merchant approves (or
      // declines) a charge. Confirm the plan straight away rather than waiting on the
      // APP_SUBSCRIPTIONS_UPDATE webhook, which can lag by seconds to minutes — without
      // this the merchant pays and then sees "Free plan" on the very next screen.
      //
      // The endpoint deliberately ignores anything in this URL and asks Shopify what is
      // actually active, so a hand-edited query string cannot grant a paid tier.
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        if (params.get('billing') === 'success') {
          params.delete('billing');

          // The change the merchant went to Shopify for, written by the Plan page before
          // it handed over. Read and removed here, once, on every outcome: the answer
          // below is judged against it, the pending poll is handed it, and a stale
          // { from, to } must never outlive the hand-off it describes. Best effort —
          // storage can be unavailable in an embedded frame, and every use copes with null.
          let expected: PendingPlanChange | null = null;
          try {
            expected = parsePendingPlan(sessionStorage.getItem(PENDING_PLAN_KEY));
            sessionStorage.removeItem(PENDING_PLAN_KEY);
          } catch {
            /* no storage */
          }

          const confirmed = await apiFetch<{ activated?: boolean; pending?: boolean; plan?: string }>(
            '/api/billing/confirm'
          ).catch(() => undefined);

          // Land on the Plan tab rather than dropping the merchant back wherever they
          // happened to be: it is where they started, and where the answer shows.
          //
          // `activated` only means a paid plan is active, not that it is the one they
          // went for. A Growth store that declines Scale comes back still on Growth, and
          // marking that as an upgrade put "You just unlocked these" over features it
          // already had. So the upgrade is marked only when the plan went UP; otherwise
          // the merchant is told plainly what they are on. A return from Free still on Free
          // is handled below with the other "may still land" cases.
          if (confirmed?.activated) {
            params.set('page', 'plan');
            const outcome = classifyPlanReturn(confirmed.plan, expected);
            if (outcome === 'upgraded') {
              params.set('upgraded', '1');
            } else if (upgradeMayStillLand(confirmed.plan, expected)) {
              // Still on the old plan after going to buy a higher one. Keep asking before
              // saying anything: the poll announces the upgrade if it lands, and "no
              // change was made" only once it has waited and nothing came.
              setPlanPending({ ...expected!, unsure: true });
            } else if (confirmed.plan) {
              const name = planName(confirmed.plan);
              setPlanNotice(
                outcome === 'unchanged'
                  ? { text: `No change was made — you're still on ${name}.`, tone: 'neutral' }
                  : { text: `Switched to the ${name} plan.`, tone: 'success' }
              );
            }
            setCurrentPage('plan');
          } else if (confirmed?.pending) {
            // Shopify has the payment but could not yet be asked which plan it is for
            // (the classification query failed; the server will settle it from the
            // webhook or its next check). The merchant still goes to the Plan page — it
            // is where the answer will appear — and is told why it does not show yet,
            // instead of being dropped on the Dashboard still reading "Free".
            params.set('page', 'plan');
            setCurrentPage('plan');
            // The toast itself is raised by the polling effect: at this point the
            // authenticated shell, and the Toaster with it, has not mounted yet, and a
            // toast raised before the Toaster exists is never shown.
            setPlanPending(expected ?? {});
          } else if (expected?.to && (confirmed === undefined || upgradeMayStillLand(confirmed.plan, expected))) {
            // Free -> Growth comes back `activated: false` while Shopify is still swapping
            // the plan in — the same "may still land" as Growth -> Scale above, but it never
            // reached that branch, so the merchant was left on the Dashboard reading Free.
            // A confirm that failed outright is treated the same way: nothing is known yet.
            params.set('page', 'plan');
            setCurrentPage('plan');
            setPlanPending({ ...expected, unsure: true });
          }

          const rest = params.toString();
          window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''));
        }
      }

      // apiFetch, not fetch: it attaches the App Bridge session token. A bare fetch here
      // relied entirely on the cookie, which is exactly what stops working in Safari and
      // what Shopify's pre-submission check rejects.
      const data = await apiFetch<{ store?: StoreSummary }>('/api/store');
      if (data.store) {
        setStoreName(data.store.name);
        setStoreDomain(data.store.shopifyDomain || data.store.domain || '');
        setStorePlan(data.store.plan);
        setIsAuthenticated(true);
        return;
      }
      setAuthDetail('');
      setIsAuthenticated(false);
    } catch (err) {
      // Session invalid or network failure. Keep the server's reason for the card below;
      // ApiError's message is already the merchant-safe text the route chose to send.
      setAuthDetail(err instanceof ApiError ? sanitiseReason(err.message) : '');
      setIsAuthenticated(false);
    } finally {
      // Must run on EVERY path. This previously sat after the try/catch, so the
      // successful branch above returned early and never cleared it — leaving the app
      // stuck on the loading screen forever, but only once auth actually worked.
      setIsLoading(false);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!authError) {
      checkSession();
      return;
    }
    // Arriving at /?error=... means Shopify (or our own callback) rejected the install,
    // so there is no session to check. `isLoading` still has to be cleared: without this
    // the effect returned early with it left true and the app sat on the loading screen
    // forever, showing a spinner instead of the error it was redirected here to display.
    setIsLoading(false);
  }, [authError, checkSession]);

  // Usage figures for the plan meter and the pending badge, refreshed whenever the
  // merchant lands back on a screen that could have changed them.
  //
  // One request, not two. This used to call /api/analytics alongside /api/usage purely to
  // read `pendingReviews` — fifteen aggregates and a thirty-day scan, on every navigation,
  // for one integer, while the comment above it claimed analytics was avoided precisely
  // because it was expensive. `getUsage` returns the count now.
  const applyUsage = useCallback((u: UsageSummary) => {
    setUsage({
      requests: u.requests?.used ?? 0,
      cap: u.requests?.limit ?? null,
      pending: u.pendingReviews ?? 0,
    });
    // The plan comes from here too, not only from the mount-time /api/store call.
    //
    // Those were two copies of one fact with different refresh rates: the badge was
    // read once at mount and never again, while the quota beside it refreshed on
    // every navigation. Downgrading to Free left a sidebar reading "Growth · 3/100"
    // — a paid label next to a free allowance, both rendered from the same component.
    //
    // /api/usage derives the plan the same way every server-side gate does, and it is
    // already fetched on every navigation, so making it the single source removes the
    // drift rather than adding a second refresh to chase it.
    if (u.plan) setStorePlan(u.plan);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    apiFetch<UsageSummary>('/api/usage').then(applyUsage).catch(() => undefined);
  }, [isAuthenticated, currentPage, applyUsage]);

  // After a return from Shopify that could not be settled at once — confirm could not
  // classify, or the merchant came back on the plan they left: ask Shopify a few more
  // times, a few seconds apart, and stop as soon as the plan they bought shows up. The Plan page is told (usageVersion)
  // so its own "Current plan" header catches up at the same moment as the chip.
  useEffect(() => {
    if (!planPending || !isAuthenticated) return;
    // `unsure`: the merchant came back on their old plan, which is what a decline looks
    // like too, so nothing is claimed about a payment until Shopify says so.
    if (planPending.unsure) toast.info('Checking your plan with Shopify…', { duration: 6000 });
    else toast.info('Payment received — your plan will update within a minute.', { duration: 10000 });
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The change the merchant went to Shopify for, read from storage once by checkSession
    // and handed over in state — see planArrived for why the poll waits for that plan
    // rather than for any paid one.
    const expected = planPending;
    // The last plan Shopify actually reported. The final word is about THIS, never about
    // what we assumed: a poll that never got an answer says nothing, and a plan that moved
    // somewhere else (the merchant cancelled from the Plan tab meanwhile) is not "no change".
    let lastSeen: string | undefined;
    // Refresh the chip and meter. Deliberately not gated on `cancelled`: the shell stays
    // mounted, and every caller runs this BEFORE ending the poll — ending it first ran the
    // effect's cleanup, and the refresh that came back afterwards was thrown away.
    const settle = async () => {
      try {
        applyUsage(await apiFetch<UsageSummary>('/api/usage'));
      } catch {
        /* the chip catches up on the next navigation */
      }
    };
    const tick = async () => {
      attempts++;
      try {
        // Shopify, not our own database. /api/usage reads store.plan, which only the
        // webhook could change inside this window — and confirm has just stamped the
        // reconcile marker, so nothing else would ask. confirm asks Shopify every time,
        // writes what it finds, and is safe to repeat.
        const c = await apiFetch<{ activated?: boolean; pending?: boolean; plan?: string }>('/api/billing/confirm');
        if (cancelled) return;
        if (!c.pending && c.plan) {
          lastSeen = c.plan;
          if (planArrived(c.plan, expected)) {
            await settle();
            if (cancelled) return;
            // A move down that settled late (Scale -> Growth) is said plainly; only a move
            // up gets the unlock panel, which the Plan page now decides by rank.
            if (classifyPlanReturn(c.plan, expected) !== 'upgraded') {
              setPlanNotice({ text: `Switched to the ${planName(c.plan)} plan.`, tone: 'success' });
            }
            setPlanPending(null);
            setUsageVersion((v) => v + 1);
            return;
          }
          if (expected.from && c.plan !== expected.from) {
            // Moved, but not to what was bought: the merchant changed course. Show what
            // is true and stop — no announcement either way.
            await settle();
            if (cancelled) return;
            setPlanPending(null);
            setUsageVersion((v) => v + 1);
            return;
          }
        }
      } catch {
        // A failed poll is not news; the next one may succeed.
      }
      if (cancelled) return;
      if (attempts < PLAN_POLL_ATTEMPTS) {
        timer = setTimeout(tick, PLAN_POLL_INTERVAL_MS);
      } else {
        await settle();
        if (cancelled) return;
        setPlanPending(null);
        if (expected.unsure && expected.from && lastSeen === expected.from) {
          setPlanNotice({ text: `No change was made — you're still on ${planName(expected.from)}.`, tone: 'neutral' });
        }
      }
    };
    timer = setTimeout(tick, PLAN_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [planPending, isAuthenticated, applyUsage]);

  // Raised once, after the shell (and the Toaster with it) has mounted, then cleared so a
  // later change of isAuthenticated cannot repeat it.
  useEffect(() => {
    if (!planNotice || !isAuthenticated) return;
    if (planNotice.tone === 'success') toast.success(planNotice.text);
    else toast(planNotice.text);
    setPlanNotice(null);
  }, [planNotice, isAuthenticated]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /**
   * Navigate, and say so in the URL.
   *
   * `pushState` rather than `replaceState`: each screen becomes a back-button stop, which
   * is what a merchant expects from something that looks like a set of pages. The shop
   * and host parameters are preserved — Shopify puts them on every embedded request and
   * dropping them breaks the session-token handshake on the next reload.
   */
  const navigate = useCallback((page: PageId, opts?: NavigateOptions) => {
    setCurrentPage(page);
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    params.set('page', page);
    // A tab within the destination, read once by the page on mount and then cleared by
    // it, so a plain navigation never inherits a tab asked for by an earlier link.
    if (opts?.tab) params.set('tab', opts.tab);
    else params.delete('tab');
    window.history.pushState({ page }, '', `${window.location.pathname}?${params}`);
  }, []);

  // The other direction. Covers the browser's back and forward buttons, and App Bridge
  // driving the frame from the navigation menu — which it does through the History API,
  // so there is no reload to hook and no click of ours to intercept.
  useEffect(() => {
    const onPop = () => setCurrentPage(pageFromUrl() ?? 'dashboard');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // ── Loading ──
  if (isLoading) {
    return (
      <div className="aurora flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-5">
          <img src={BRAND_ASSETS.icon96} alt="" width={56} height={56} className="size-14 rounded-2xl" />
          {/* A static indicator with a status line, as the guidelines ask of loading states. */}
          <div className="text-center" role="status">
            <p className="text-[14px]" aria-label={APP_NAME}>
              <MarkaLockup size={16} />
            </p>
            <p className="mt-0.5 text-[12.5px] text-ink-400">Connecting to your store…</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Not authenticated ──
  //
  // Inside the admin frame this must NOT be the marketing page.
  //
  // WelcomeScreen is, by its own docstring, "a sales page" — hero, proof points and an
  // "Install from the Shopify App Store" button. Rendering it on any auth failure meant a
  // merchant whose session had simply expired, or an App Store reviewer whose token call
  // hit a blip, was shown an advert telling them to install the app they were already
  // inside. It is the right screen for someone who has landed on the app's public URL and
  // the wrong one for someone sitting in their own Shopify admin.
  //
  // Embedded, the recoverable action is to reload — App Bridge mints a fresh session token
  // on load, which is what fixes an expired one.
  if (!isAuthenticated) {
    if (isEmbedded) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-6">
          <div className="surface w-full max-w-md rounded-2xl p-8 text-center">
            <img src={BRAND_ASSETS.icon96} alt="" width={48} height={48} className="mx-auto mb-4 size-12 rounded-xl" />
            <h1 className="text-[16px] font-bold text-ink-900 dark:text-white">
              Could not reach your store
            </h1>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-500">
              {authError || 'Your session expired. Reloading usually fixes it.'}
            </p>
            {/* The server's reason, when it gave one, so a real install problem is not
                hidden behind advice to reload — and so support can be told what it said. */}
            {authDetail && !authError && (
              <p className="mt-2 text-[12px] leading-relaxed text-ink-400">{authDetail}</p>
            )}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 h-9 rounded-lg bg-ink-900 px-4 text-[13px] font-semibold text-white hover:opacity-90 dark:bg-white dark:text-ink-900"
            >
              Reload
            </button>
            <p className="mt-4 text-[12px] text-ink-400">
              Still stuck? Email tech@houseofmarka.com and we will sort it out.
            </p>
          </div>
        </div>
      );
    }
    return (
      <WelcomeScreen error={authError} />
    );
  }

  // ── Authenticated ──
  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard': return <DashboardPage onNavigate={navigate} storeName={storeName} />;
      case 'reviews': return <ReviewsPage />;
      case 'bulk-upload': return <BulkUploadPage />;
      case 'questions': return <QuestionsPage storeDomain={storeDomain} onNavigate={navigate} />;
      case 'products': return <ProductsPage storeDomain={storeDomain} />;
      case 'widgets': return <WidgetsPage storeDomain={storeDomain} />;
      case 'incentives': return <IncentivesPage />;
      case 'settings': return <SettingsPage key="settings" onNavigate={navigate} storeDomain={storeDomain} usageVersion={usageVersion} onPlanChangeStarted={stopPlanCheck} />;
      case 'plan': return <SettingsPage key="plan" onNavigate={navigate} storeDomain={storeDomain} initialTab="subscription" usageVersion={usageVersion} onPlanChangeStarted={stopPlanCheck} />;
      default: return <DashboardPage onNavigate={navigate} storeName={storeName} />;
    }
  };

  // -- Authenticated, but not inside Shopify's admin --
  // A session cookie in a plain tab used to render the entire admin here, unstyled nav
  // and all, for whichever store the cookie happened to point at. Point at the real
  // surface instead.
  if (!isEmbedded) {
    const handle = storeDomain.replace('.myshopify.com', '');
    return (
      <div className="aurora flex min-h-screen items-center justify-center bg-background p-6">
        <div className="surface w-full max-w-md rounded-2xl p-8 text-center">
          <img src={BRAND_ASSETS.icon96} alt="" width={48} height={48} className="mx-auto mb-4 size-12 rounded-xl" />
          <h1 className="text-[16px] font-bold text-ink-900 dark:text-white">{APP_NAME} runs inside Shopify</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-500">
            This page only works embedded in your Shopify admin, where it can talk to your
            store securely.
          </p>
          {handle && (
            <a
              href={`https://admin.shopify.com/store/${handle}/apps/reviewmaster-reviews`}
              className="mt-5 inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-brand-600 px-4 text-[13px] font-semibold text-white transition-colors hover:bg-brand-700"
            >
              Open in Shopify admin
              <ExternalLink className="size-3.5" />
            </a>
          )}
        </div>
      </div>
    );
  }

  const storefrontUrl = storeDomain ? `https://${storeDomain}` : null;

  return (
    <ConfirmProvider>
    {/*
      Shopify's own navigation menu.

      A Built for Shopify criterion, and without it the app's screens exist only inside
      its own frame: a merchant browsing the admin sees "Marka Reviews" as a single
      destination with nothing under it, while every other app they have lists its
      sections in the sidebar.

      Rendered by Shopify in the admin chrome, outside this iframe, from these anchors —
      which is why they must be real hrefs. A click cannot be intercepted here; App Bridge
      drives the frame through the History API, and `navigate`/`popstate` above are what
      pick it up.

      `rel="home"` marks the entry Shopify shows under the app's own name. Exactly one
      link must carry it, and it must be the first.

      Lower-case `ui-nav-menu` is a custom element defined by the App Bridge script in
      layout.tsx, so React passes it through to the DOM untouched rather than treating it
      as a component.
    */}
    <ui-nav-menu>
      <a href="/?page=dashboard" rel="home">Dashboard</a>
      {PAGE_IDS.filter((id) => id !== 'dashboard').map((id) => (
        <a key={id} href={`/?page=${id}`}>{PAGE_TITLES[id].title}</a>
      ))}
    </ui-nav-menu>

    <div className="aurora min-h-screen bg-background">
      <TopNav
        currentPage={currentPage}
        onPageChange={navigate}
        storeName={storeName}
        storeDomain={storeDomain}
        plan={storePlan}
        requestsUsed={usage.requests}
        requestsCap={usage.cap}
        pendingCount={usage.pending}
      />

      {/*
        One centred column, capped and padded, rather than a flex row offset by a fixed
        rail. The old shell was `ml-[264px] flex-1` with no `min-w-0`, which had two
        consequences: the content could not shrink below the intrinsic width of its widest
        unbreakable string, and every `sm:`/`lg:` breakpoint in the app was measuring a
        viewport 264px wider than the space those classes were actually laying out into.
        Both are gone with the rail. The cap keeps line lengths readable on a wide monitor
        instead of stretching tables and paragraphs across the whole screen.
      */}
      <main className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            {pageInfo.parent && (
              <nav aria-label="Breadcrumb" className="mb-1 flex items-center gap-1 text-[11.5px]">
                <span className="font-medium text-ink-400">{pageInfo.parent}</span>
                <ChevronRight className="size-3 text-ink-300" />
                <span className="font-semibold text-ink-600 dark:text-ink-300">{pageInfo.title}</span>
              </nav>
            )}
            <h1 className="text-[20px] font-bold leading-tight tracking-tight text-ink-900 dark:text-white">
              {pageInfo.title}
            </h1>
            <p className="mt-0.5 text-[12.5px] text-ink-500">{pageInfo.desc}</p>
          </div>

          {/* Below `sm` the storefront link is dropped from the top bar, so it reappears
              here rather than becoming unreachable on a narrow screen. */}
          {storefrontUrl && (
            <a
              href={storefrontUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ring-focus surface inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[12.5px] font-semibold text-ink-600 transition-colors hover:border-ink-300 hover:text-ink-900 sm:hidden dark:text-ink-300 dark:hover:text-white"
            >
              View store
              <ExternalLink className="size-3.5" />
            </a>
          )}
        </div>

        {/* `key` restarts the entrance animation on every navigation, so moving between
            screens has a beat to it rather than snapping. */}
        <div key={currentPage} className="animate-fade">
          {renderPage()}
        </div>
      </main>

      <Toaster
        position="top-right"
        richColors
        toastOptions={{
          style: {
            borderRadius: '14px',
            boxShadow: 'var(--elev-3)',
          },
        }}
      />
    </div>
    </ConfirmProvider>
  );
}
