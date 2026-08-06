'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Sidebar, { type PageId } from '@/components/app/Sidebar';
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
import { Pill } from '@/components/app/ui-kit';

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

interface StoreSummary {
  name: string;
  shopifyDomain?: string;
  domain?: string;
  plan: string;
}

export default function Home() {
  const [currentPage, setCurrentPage] = useState<PageId>('dashboard');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [storeName, setStoreName] = useState('');
  const [storeDomain, setStoreDomain] = useState('');
  const [storePlan, setStorePlan] = useState('free');
  const [shopInput, setShopInput] = useState('');
  // Usage for the sidebar plan meter. Kept here rather than inside Sidebar so a
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

  // Usage figures for the plan meter, refreshed whenever the merchant lands back on
  // a screen that could have changed them. /api/usage rather than /api/analytics: the
  // meter is monthly request volume, and analytics loads every review row to compute
  // aggregates nobody needs in the sidebar.
  useEffect(() => {
    if (!isAuthenticated) return;
    Promise.all([
      apiFetch<{ requests: { used: number; limit: number | null } }>('/api/usage'),
      apiFetch<{ pendingReviews: number }>('/api/analytics'),
    ])
      .then(([u, a]) =>
        setUsage({
          requests: u.requests?.used ?? 0,
          cap: u.requests?.limit ?? null,
          pending: a.pendingReviews ?? 0,
        })
      )
      .catch(() => undefined);
  }, [isAuthenticated, currentPage]);
  /* eslint-enable react-hooks/set-state-in-effect */

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
    window.location.href = `/api/auth/install?shop=${shopDomain}`;
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
      case 'dashboard': return <DashboardPage onNavigate={setCurrentPage} storeName={storeName} />;
      case 'reviews': return <ReviewsPage />;
      case 'bulk-upload': return <BulkUploadPage />;
      case 'questions': return <QuestionsPage />;
      case 'products': return <ProductsPage />;
      case 'widgets': return <WidgetsPage />;
      case 'incentives': return <IncentivesPage />;
      case 'settings': return <SettingsPage onNavigate={setCurrentPage} />;
      default: return <DashboardPage onNavigate={setCurrentPage} storeName={storeName} />;
    }
  };

  const storefrontUrl = storeDomain ? `https://${storeDomain}` : null;

  return (
    <div className="aurora flex min-h-screen bg-background">
      <Sidebar
        currentPage={currentPage}
        onPageChange={setCurrentPage}
        storeName={storeName}
        storeDomain={storeDomain}
        plan={storePlan}
        requestsUsed={usage.requests}
        requestsCap={usage.cap}
        pendingCount={usage.pending}
      />

      <main className="ml-[264px] flex-1">
        <header className="glass sticky top-0 z-30 border-b border-border">
          <div className="flex items-center justify-between gap-4 px-7 py-4">
            <div className="min-w-0">
              {pageInfo.parent && (
                <nav aria-label="Breadcrumb" className="mb-1 flex items-center gap-1 text-[11.5px]">
                  <span className="font-medium text-ink-400">{pageInfo.parent}</span>
                  <ChevronRight className="size-3 text-ink-300" />
                  <span className="font-semibold text-ink-600 dark:text-ink-300">
                    {pageInfo.title}
                  </span>
                </nav>
              )}
              <h1 className="text-[20px] font-bold leading-tight tracking-tight text-ink-900 dark:text-white">
                {pageInfo.title}
              </h1>
              <p className="mt-0.5 truncate text-[12.5px] text-ink-500">{pageInfo.desc}</p>
            </div>

            <div className="flex shrink-0 items-center gap-2.5">
              <Pill tone={storePlan === 'free' ? 'neutral' : 'brand'} className="capitalize">
                {storePlan} plan
              </Pill>
              {storefrontUrl && (
                <a
                  href={storefrontUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ring-focus surface inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-[12.5px] font-semibold text-ink-600 transition-colors hover:border-ink-300 hover:text-ink-900 dark:text-ink-300 dark:hover:text-white"
                >
                  View store
                  <ExternalLink className="size-3.5" />
                </a>
              )}
            </div>
          </div>
        </header>

        {/* `key` restarts the entrance animation on every navigation, so moving between
            screens has a beat to it rather than snapping. */}
        <div key={currentPage} className="animate-fade px-7 py-6">
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
  );
}
