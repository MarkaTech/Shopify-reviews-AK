'use client';

import React, { useState, useEffect, useCallback } from 'react';
import TopNav, { type PageId } from '@/components/app/TopNav';
import { ConfirmProvider } from '@/components/app/confirm';
import DashboardPage from '@/components/app/DashboardPage';
import ReviewsPage from '@/components/app/ReviewsPage';
import BulkUploadPage from '@/components/app/BulkUploadPage';
import WidgetsPage from '@/components/app/WidgetsPage';
import SettingsPage from '@/components/app/SettingsPage';
import ProductsPage from '@/components/app/ProductsPage';
import QuestionsPage from '@/components/app/QuestionsPage';
import IncentivesPage from '@/components/app/IncentivesPage';
import WelcomeScreen from '@/components/app/WelcomeScreen';
import { Toaster } from 'sonner';
import { Star, ExternalLink, ChevronRight } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { navigateTop } from '@/lib/admin-links';

const PAGE_TITLES: Record<PageId, { title: string; desc: string; parent?: string }> = {
  dashboard: { title: 'Dashboard', desc: 'How your reviews are performing' },
  reviews: { title: 'All reviews', desc: 'Moderate, reply to and feature customer reviews', parent: 'Reviews' },
  'bulk-upload': { title: 'Import', desc: 'Bring in reviews you own, or collect them from real orders', parent: 'Reviews' },
  questions: { title: 'Questions', desc: 'Answer shopper questions and publish them to product pages', parent: 'Reviews' },
  products: { title: 'Products', desc: 'Products synced from your Shopify catalogue', parent: 'Store' },
  widgets: { title: 'Widgets', desc: 'Design how reviews appear on your storefront', parent: 'Store' },
  incentives: { title: 'Incentives', desc: 'Reward reviewers with a discount — never tied to what they say', parent: 'Store' },
  settings: { title: 'Settings', desc: 'Moderation rules, email timing, plan and billing', parent: 'Store' },
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

export default function Home() {
  // Initialised from the URL, so a reload, a bookmark or a nav-menu click all land on
  // the screen that was asked for rather than on the dashboard.
  const [currentPage, setCurrentPage] = useState<PageId>(() => pageFromUrl() ?? 'dashboard');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [storeName, setStoreName] = useState('');
  const [storeDomain, setStoreDomain] = useState('');
  const [storePlan, setStorePlan] = useState('free');
  const [shopInput, setShopInput] = useState('');
  // Usage for the top bar's plan meter. Kept here rather than inside TopNav so a
  // single fetch serves both it and anything else the shell needs.
  const [usage, setUsage] = useState<{ requests: number; cap: number | null; pending: number }>({
    requests: 0,
    cap: null,
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
          const rest = params.toString();
          window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''));
          await apiFetch('/api/billing/confirm').catch(() => undefined);
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
      setIsAuthenticated(false);
    } catch {
      // Session invalid or network failure
      setIsAuthenticated(false);
    } finally {
      // Must run on EVERY path. This previously sat after the try/catch, so the
      // successful branch above returned early and never cleared it — leaving the app
      // stuck on "Loading ReviewMaster..." forever, but only once auth actually worked.
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
  useEffect(() => {
    if (!isAuthenticated) return;
    apiFetch<{
      plan: string;
      pendingReviews: number;
      requests: { used: number; limit: number | null };
    }>('/api/usage')
      .then((u) => {
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
      })
      .catch(() => undefined);
  }, [isAuthenticated, currentPage]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /**
   * Navigate, and say so in the URL.
   *
   * `pushState` rather than `replaceState`: each screen becomes a back-button stop, which
   * is what a merchant expects from something that looks like a set of pages. The shop
   * and host parameters are preserved — Shopify puts them on every embedded request and
   * dropping them breaks the session-token handshake on the next reload.
   */
  const navigate = useCallback((page: PageId) => {
    setCurrentPage(page);
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    params.set('page', page);
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

  const handleInstall = async () => {
    const shop = shopInput.trim().toLowerCase();
    if (!shop) {
      setAuthError('Please enter your store URL');
      return;
    }

    const shopDomain = shop.includes('.myshopify.com') ? shop : `${shop}.myshopify.com`;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/.test(shopDomain)) {
      setAuthError('That does not look like a Shopify store URL.');
      return;
    }

    setAuthError('');
    // window.top, not window.location. This screen can render inside Shopify's iframe on
    // the reauth path, and Shopify's OAuth consent screen refuses to be framed — so
    // navigating the frame produced a blank rectangle exactly when a merchant most needed
    // the flow to work. The Etsy and billing handoffs already did this correctly.
    // Absolute, because navigateTop leaves our origin behind: a relative path assigned
    // to window.top.location resolves against admin.shopify.com, which would have sent
    // the merchant to a Shopify 404 instead of our install route.
    navigateTop(`${window.location.origin}/api/auth/install?shop=${shopDomain}`);
  };

  // ── Loading ──
  if (isLoading) {
    return (
      <div className="aurora flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-5">
          <div className="relative">
            <div className="absolute inset-0 rounded-2xl bg-brand-500/30 blur-xl" />
            <span className="tile tile-brand pulse-ring relative size-14">
              <Star className="size-7" fill="currentColor" strokeWidth={0} />
            </span>
          </div>
          <div className="text-center">
            <p className="text-[14px] font-semibold text-ink-800 dark:text-white">ReviewMaster</p>
            <p className="mt-0.5 text-[12.5px] text-ink-400">Connecting to your store…</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Not authenticated ──
  if (!isAuthenticated) {
    return (
      <WelcomeScreen
        shopInput={shopInput}
        onShopInput={setShopInput}
        onInstall={handleInstall}
        error={authError}
      />
    );
  }

  // ── Authenticated ──
  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard': return <DashboardPage onNavigate={navigate} storeName={storeName} />;
      case 'reviews': return <ReviewsPage />;
      case 'bulk-upload': return <BulkUploadPage />;
      case 'questions': return <QuestionsPage />;
      case 'products': return <ProductsPage storeDomain={storeDomain} />;
      case 'widgets': return <WidgetsPage />;
      case 'incentives': return <IncentivesPage />;
      case 'settings': return <SettingsPage onNavigate={navigate} storeDomain={storeDomain} />;
      default: return <DashboardPage onNavigate={navigate} storeName={storeName} />;
    }
  };

  const storefrontUrl = storeDomain ? `https://${storeDomain}` : null;

  return (
    <ConfirmProvider>
    {/*
      Shopify's own navigation menu.

      A Built for Shopify criterion, and without it the app's screens exist only inside
      its own frame: a merchant browsing the admin sees "ReviewMaster" as a single
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
